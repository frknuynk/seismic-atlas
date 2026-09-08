import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { NormalizedSourceEvent } from '@/shared/schemas';
import { runAfadSync } from '@/worker/ingestion/afad';
import { persistEventsInBatches } from '@/worker/ingestion/persistence';

type BoundStatement = {
  sql: string;
  bindings: SQLInputValue[];
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
};

function sqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of [
    '0000_wild_champions.sql',
    '0001_lame_lilith.sql',
    '0002_faulty_king_bedlam.sql',
    '0003_needy_shiver_man.sql',
    '0004_free_saracen.sql',
    '0005_round_firestar.sql',
  ]) {
    sqlite.exec(
      readFileSync(
        new URL(`../migrations/${migration}`, import.meta.url),
        'utf8',
      ),
    );
  }

  const bound = (sql: string, bindings: unknown[]): BoundStatement => ({
    sql,
    bindings: bindings as SQLInputValue[],
    async all<T>() {
      const results = sqlite.prepare(sql).all(...this.bindings) as T[];
      return { results };
    },
    async first<T>() {
      return (
        (sqlite.prepare(sql).get(...this.bindings) as T | undefined) ?? null
      );
    },
    async run() {
      const result = sqlite.prepare(sql).run(...this.bindings);
      return { meta: { changes: Number(result.changes) } };
    },
  });

  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return bound(sql, bindings);
        },
      };
    },
    async batch(statements: BoundStatement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;

  return { db, sqlite };
}

function event(sourceEventId: string, magnitude = 2.1): NormalizedSourceEvent {
  return {
    source: 'AFAD',
    sourceEventId,
    originTime: '2026-09-08T12:00:00.000Z',
    latitude: 39,
    longitude: 35,
    depthKm: 7,
    magnitude,
    magnitudeType: 'ML',
    placeRaw: 'Türkiye',
    sourceStatus: magnitude === 2.1 ? 'original' : 'updated',
    sourceUpdatedAt: magnitude === 2.1 ? null : '2026-09-08T12:10:00.000Z',
  };
}

let activeDatabase: DatabaseSync | null = null;

afterEach(() => {
  activeDatabase?.close();
  activeDatabase = null;
});

describe('D1 ingestion SQL', () => {
  it('bulk upserts events and stores exactly one revision per payload', async () => {
    const database = sqliteD1();
    activeDatabase = database.sqlite;

    await expect(
      persistEventsInBatches(
        database.db,
        [event('event-1'), event('event-2')],
        1_000,
      ),
    ).resolves.toMatchObject({ inserted: 2, updated: 0, unchanged: 0 });

    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM source_events')
        .get(),
    ).toMatchObject({ count: 2 });
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM source_event_revisions')
        .get(),
    ).toMatchObject({ count: 2 });

    await expect(
      persistEventsInBatches(
        database.db,
        [event('event-1'), event('event-2')],
        2_000,
      ),
    ).resolves.toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM source_event_revisions')
        .get(),
    ).toMatchObject({ count: 2 });

    await expect(
      persistEventsInBatches(
        database.db,
        [event('event-1', 3.4), event('event-2')],
        3_000,
      ),
    ).resolves.toMatchObject({ inserted: 0, updated: 1, unchanged: 1 });

    expect(
      database.sqlite
        .prepare(
          `SELECT revision_no, magnitude
          FROM source_event_revisions
          WHERE source_event_pk = 'AFAD:event-1'
          ORDER BY revision_no`,
        )
        .all(),
    ).toEqual([
      { revision_no: 1, magnitude: 2.1 },
      { revision_no: 2, magnitude: 3.4 },
    ]);
    expect(
      database.sqlite
        .prepare(
          `SELECT magnitude, first_seen_at, last_seen_at
          FROM source_events
          WHERE id = 'AFAD:event-1'`,
        )
        .get(),
    ).toEqual({ magnitude: 3.4, first_seen_at: 1_000, last_seen_at: 3_000 });
  });

  it('commits a complete run, cursor, audit, and lease release atomically', async () => {
    const database = sqliteD1();
    activeDatabase = database.sqlite;
    const runStartedAt = Date.parse('2026-09-08T12:05:00.000Z');

    const result = await runAfadSync(database.db, {
      now: new Date(runStartedAt),
      clock: () => runStartedAt + 1_000,
      fetchWindow: async () => ({
        events: [event('event-1'), event('event-2')],
        rejections: [
          {
            sourceEventId: 'bad-event',
            reason: 'date:invalid_type',
            rawJson: '{"eventID":"bad-event"}',
          },
        ],
        attempts: 1,
        splits: 0,
        received: 3,
        rejected: 1,
        duplicatesDropped: 0,
      }),
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      fetched: 3,
      accepted: 2,
      rejected: 1,
      inserted: 2,
      writeBatches: 1,
    });
    expect(
      database.sqlite
        .prepare(
          `SELECT status, fetched, accepted, rejected, inserted, write_batches
          FROM ingestion_runs`,
        )
        .get(),
    ).toEqual({
      status: 'succeeded',
      fetched: 3,
      accepted: 2,
      rejected: 1,
      inserted: 2,
      write_batches: 1,
    });
    expect(
      database.sqlite
        .prepare(
          `SELECT adapter_version, last_success_window_end
          FROM ingestion_state WHERE source = 'AFAD'`,
        )
        .get(),
    ).toEqual({
      adapter_version: 'afad-v3',
      last_success_window_end: runStartedAt,
    });
    expect(
      database.sqlite
        .prepare(
          `SELECT status, consecutive_failures
          FROM source_health WHERE source = 'AFAD'`,
        )
        .get(),
    ).toEqual({ status: 'ok', consecutive_failures: 0 });
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM ingestion_rejections')
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM ingestion_leases')
        .get(),
    ).toEqual({ count: 0 });
  });
});
