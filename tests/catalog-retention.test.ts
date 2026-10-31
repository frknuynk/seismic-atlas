import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CATALOG_RETENTION_MS,
  pruneRecentAfadCatalog,
} from '@/worker/catalog-retention';

type BoundStatement = {
  sql: string;
  bindings: SQLInputValue[];
  run(): Promise<{ meta: { changes: number } }>;
};

function retentionDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of [
    '0000_wild_champions.sql',
    '0001_lame_lilith.sql',
    '0002_faulty_king_bedlam.sql',
    '0003_needy_shiver_man.sql',
    '0004_free_saracen.sql',
    '0005_round_firestar.sql',
    '0006_optimal_umar.sql',
    '0007_multi_source_catalog.sql',
  ]) {
    sqlite.exec(
      readFileSync(
        new URL(`../migrations/${migration}`, import.meta.url),
        'utf8',
      ),
    );
  }

  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            sql,
            bindings: bindings as SQLInputValue[],
            async run() {
              const result = sqlite
                .prepare(sql)
                .run(...(bindings as SQLInputValue[]));
              return { meta: { changes: Number(result.changes) } };
            },
          } satisfies BoundStatement;
        },
        async run() {
          const result = sqlite.prepare(sql).run();
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
    async batch(statements: BoundStatement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
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

let activeDatabase: DatabaseSync | null = null;

afterEach(() => {
  activeDatabase?.close();
  activeDatabase = null;
});

describe('recent AFAD catalog retention', () => {
  it('keeps recent AFAD data and removes old or inactive-source payloads safely', async () => {
    const database = retentionDatabase();
    activeDatabase = database.sqlite;
    const now = Date.parse('2026-10-31T12:00:00.000Z');
    const recent = now - CATALOG_RETENTION_MS + 60_000;
    const old = now - CATALOG_RETENTION_MS - 1;
    const insertEvent = database.sqlite.prepare(
      `INSERT INTO source_events (
        id, source, source_event_id, origin_time, latitude, longitude,
        first_seen_at, last_seen_at, payload_hash
      ) VALUES (?, ?, ?, ?, 39, 35, ?, ?, ?)`,
    );
    insertEvent.run('AFAD:recent', 'AFAD', 'recent', recent, recent, recent, 'a');
    insertEvent.run('AFAD:old', 'AFAD', 'old', old, old, old, 'b');
    insertEvent.run('USGS:recent', 'USGS', 'recent', recent, recent, recent, 'c');

    const insertRevision = database.sqlite.prepare(
      `INSERT INTO source_event_revisions (
        source_event_pk, revision_no, payload_hash, observed_at, origin_time,
        latitude, longitude, raw_json
      ) VALUES (?, 1, ?, ?, ?, 39, 35, ?)`,
    );
    insertRevision.run('AFAD:recent', 'a', recent, recent, '{"source":"AFAD"}');
    insertRevision.run('AFAD:old', 'b', old, old, '{"source":"AFAD"}');
    insertRevision.run('USGS:recent', 'c', recent, recent, '{"source":"USGS"}');

    database.sqlite.exec(
      `INSERT INTO canonical_events (
        id, preferred_source_event_pk, association_version, created_at, updated_at
      ) VALUES ('CAN:1', 'USGS:recent', 'test', ${recent}, ${recent});
      INSERT INTO canonical_event_members (
        canonical_event_id, source_event_pk, association_method, associated_at
      ) VALUES ('CAN:1', 'AFAD:recent', 'test', ${recent});
      INSERT INTO canonical_event_members (
        canonical_event_id, source_event_pk, association_method, associated_at
      ) VALUES ('CAN:1', 'USGS:recent', 'test', ${recent});
      INSERT INTO ingestion_runs (
        id, source, trigger, status, window_start, window_end, started_at
      ) VALUES ('afad-run', 'AFAD', 'manual', 'succeeded', ${old}, ${recent}, ${recent});
      INSERT INTO ingestion_runs (
        id, source, trigger, status, window_start, window_end, started_at
      ) VALUES ('usgs-run', 'USGS', 'manual', 'succeeded', ${old}, ${recent}, ${recent});
      INSERT INTO ingestion_rejections (
        run_id, source, reason, observed_at, raw_json
      ) VALUES ('afad-run', 'AFAD', 'old', ${old}, '{}');
      INSERT INTO ingestion_rejections (
        run_id, source, reason, observed_at, raw_json
      ) VALUES ('usgs-run', 'USGS', 'inactive', ${recent}, '{}');
      INSERT INTO source_health (source, consecutive_failures, status)
      VALUES ('USGS', 0, 'ok');
      INSERT INTO ingestion_state (source, adapter_version)
      VALUES ('USGS', 'test');`,
    );

    const result = await pruneRecentAfadCatalog(database.db, now);

    expect(result).toMatchObject({
      eventsDeleted: 2,
      revisionsDeleted: 2,
      rejectionsDeleted: 2,
      inactiveSourceRunsDeleted: 1,
    });
    expect(
      database.sqlite
        .prepare('SELECT id, source FROM source_events')
        .all(),
    ).toEqual([{ id: 'AFAD:recent', source: 'AFAD' }]);
    expect(
      database.sqlite
        .prepare('SELECT preferred_source_event_pk FROM canonical_events')
        .get(),
    ).toEqual({ preferred_source_event_pk: 'AFAD:recent' });
    expect(
      database.sqlite
        .prepare('SELECT source_event_pk FROM canonical_event_members')
        .all(),
    ).toEqual([{ source_event_pk: 'AFAD:recent' }]);
    expect(
      database.sqlite
        .prepare('SELECT source FROM ingestion_runs')
        .all(),
    ).toEqual([{ source: 'AFAD' }]);
    expect(
      database.sqlite.prepare('SELECT COUNT(*) AS count FROM ingestion_rejections').get(),
    ).toEqual({ count: 0 });
  });
});
