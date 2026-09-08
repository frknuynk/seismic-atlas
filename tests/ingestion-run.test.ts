import { describe, expect, it } from 'vitest';
import type { NormalizedSourceEvent } from '@/shared/schemas';
import { IngestionLeaseLostError, runAfadSync } from '@/worker/ingestion/afad';
import type { AfadWindowResult } from '@/worker/sources/afad';

type CapturedStatement = {
  sql: string;
  bindings: unknown[];
};

function ingestionDatabase({ renewChanges = 1 } = {}) {
  const runStatements: CapturedStatement[] = [];
  const batches: CapturedStatement[][] = [];
  let renewals = 0;

  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          const statement: CapturedStatement & {
            run: () => Promise<{ meta: { changes: number } }>;
            first: () => Promise<null>;
          } = {
            sql,
            bindings,
            async run() {
              runStatements.push(statement);
              if (
                sql.includes('UPDATE ingestion_leases\n      SET expires_at')
              ) {
                renewals += 1;
                return { meta: { changes: renewChanges } };
              }
              return { meta: { changes: 1 } };
            },
            async first() {
              return null;
            },
          };
          return statement;
        },
      };
    },
    async batch(statements: CapturedStatement[]) {
      batches.push(statements);
      return [];
    },
  } as unknown as D1Database;

  return {
    db,
    batches,
    runStatements,
    get renewals() {
      return renewals;
    },
  };
}

const sourceEvent: NormalizedSourceEvent = {
  source: 'AFAD',
  sourceEventId: 'event-1',
  originTime: '2026-09-08T12:00:00.000Z',
  latitude: 39,
  longitude: 35,
  depthKm: 7,
  magnitude: 2.1,
  magnitudeType: 'ML',
  placeRaw: 'Türkiye',
  sourceStatus: 'original',
  sourceUpdatedAt: null,
};

function sourceResult(events = [sourceEvent]): AfadWindowResult {
  return {
    events,
    rejections: [],
    attempts: 1,
    splits: 0,
    received: events.length,
    rejected: 0,
    duplicatesDropped: 0,
  };
}

const startedAt = Date.parse('2026-09-08T12:05:00.000Z');

describe('AFAD ingestion run control', () => {
  it('does not advance the cursor when persistence fails', async () => {
    const database = ingestionDatabase();
    const failure = new Error('simulated persistence failure');

    await expect(
      runAfadSync(database.db, {
        now: new Date(startedAt),
        clock: () => startedAt + 1_000,
        fetchWindow: async () => sourceResult(),
        persistEvents: async (_db, _events, _observedAt, options) => {
          options?.onBatchCommitted?.(1);
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    const auditSql = database.batches.flat().map((statement) => statement.sql);
    expect(
      auditSql.some((sql) => sql.includes('INSERT INTO ingestion_state')),
    ).toBe(false);
    expect(auditSql.some((sql) => sql.includes("status = 'failed'"))).toBe(
      true,
    );
    expect(
      auditSql.some((sql) => sql.includes('INSERT INTO source_health')),
    ).toBe(true);
    const failedRun = database.batches
      .flat()
      .find((statement) => statement.sql.includes("status = 'failed'"));
    expect(failedRun?.bindings.slice(1, 4)).toEqual([1, 0, 1]);
  });

  it('fences a worker that loses its lease before persistence', async () => {
    const database = ingestionDatabase({ renewChanges: 0 });
    let persistenceStarted = false;

    await expect(
      runAfadSync(database.db, {
        now: new Date(startedAt),
        clock: () => startedAt + 1_000,
        fetchWindow: async () => sourceResult(),
        persistEvents: async () => {
          persistenceStarted = true;
          return { inserted: 1, updated: 0, unchanged: 0, batches: 1 };
        },
      }),
    ).rejects.toBeInstanceOf(IngestionLeaseLostError);

    expect(persistenceStarted).toBe(false);
    expect(database.batches).toHaveLength(1);
    expect(database.batches[0]).toHaveLength(1);
    expect(database.batches[0]?.[0]?.sql).toContain("status = 'failed'");
    expect(database.batches[0]?.[0]?.sql).not.toContain('source_health');
  });

  it('recovers stale runs and renews the lease during long persistence', async () => {
    const database = ingestionDatabase();
    let currentTime = startedAt + 1_000;

    const result = await runAfadSync(database.db, {
      now: new Date(startedAt),
      clock: () => currentTime,
      fetchWindow: async () => sourceResult(),
      persistEvents: async (_db, _events, _observedAt, options) => {
        currentTime += 61_000;
        await options?.beforeBatch?.();
        currentTime += 61_000;
        await options?.beforeBatch?.();
        return { inserted: 1, updated: 0, unchanged: 0, batches: 2 };
      },
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      inserted: 1,
      writeBatches: 2,
    });
    expect(database.renewals).toBe(4);
    expect(
      database.runStatements.some((statement) =>
        statement.sql.includes('INGESTION_LEASE_EXPIRED'),
      ),
    ).toBe(true);
    const successSql = database.batches
      .flat()
      .map((statement) => statement.sql);
    expect(
      successSql.some((sql) => sql.includes('INSERT INTO ingestion_state')),
    ).toBe(true);
    expect(successSql.some((sql) => sql.includes("status = 'succeeded'"))).toBe(
      true,
    );
  });
});
