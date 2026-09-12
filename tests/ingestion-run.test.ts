import { describe, expect, it } from 'vitest';
import type { NormalizedSourceEvent } from '@/shared/schemas';
import { IngestionLeaseLostError, runAfadSync } from '@/worker/ingestion/afad';
import { AfadSourceError, type AfadWindowResult } from '@/worker/sources/afad';

type CapturedStatement = {
  sql: string;
  bindings: unknown[];
};

function ingestionDatabase({
  renewChanges = 1,
  circuitRow = null,
}: {
  renewChanges?: number;
  circuitRow?: {
    consecutive_failures: number;
    circuit_open_until: number | null;
    last_error_code: string | null;
  } | null;
} = {}) {
  const runStatements: CapturedStatement[] = [];
  const batches: CapturedStatement[][] = [];
  let renewals = 0;

  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          const statement: CapturedStatement & {
            run: () => Promise<{ meta: { changes: number } }>;
            first: () => Promise<unknown>;
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
              if (sql.includes('FROM source_request_control')) {
                return circuitRow;
              }
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
  it('does not contact AFAD while the persistent source circuit is open', async () => {
    const retryAt = startedAt + 60 * 60_000;
    const database = ingestionDatabase({
      circuitRow: {
        consecutive_failures: 1,
        circuit_open_until: retryAt,
        last_error_code: 'AFAD_HTTP_429',
      },
    });
    let fetched = false;

    const result = await runAfadSync(database.db, {
      now: new Date(startedAt),
      clock: () => startedAt,
      fetchWindow: async () => {
        fetched = true;
        return sourceResult();
      },
    });

    expect(result).toEqual({
      runId: expect.any(String),
      status: 'skipped',
      reason: 'source_circuit_open',
      retryAt: new Date(retryAt).toISOString(),
      errorCode: 'AFAD_HTTP_429',
    });
    expect(fetched).toBe(false);
    expect(database.runStatements).toEqual([]);
  });

  it('persists a 24-hour circuit after AFAD rejects access', async () => {
    const database = ingestionDatabase();

    await expect(
      runAfadSync(database.db, {
        now: new Date(startedAt),
        clock: () => startedAt + 1_000,
        fetchWindow: async () => {
          throw new AfadSourceError('AFAD_HTTP_403', 'Forbidden', 1);
        },
      }),
    ).rejects.toMatchObject({ code: 'AFAD_HTTP_403' });

    const circuitWrite = database.batches
      .flat()
      .find((statement) =>
        statement.sql.includes('INSERT INTO source_request_control'),
      );
    expect(circuitWrite?.bindings).toEqual([
      'AFAD',
      1,
      startedAt + 1_000 + 24 * 60 * 60_000,
      'AFAD_HTTP_403',
      startedAt + 1_000,
    ]);
  });

  it('audits backfill without moving the scheduled ingestion cursor', async () => {
    const database = ingestionDatabase();
    let fetchedWindow: [string, string] | null = null;

    const result = await runAfadSync(database.db, {
      now: new Date(startedAt),
      clock: () => startedAt + 1_000,
      backfillWindow: {
        start: new Date('2026-09-01T00:00:00.000Z'),
        end: new Date('2026-09-02T00:00:00.000Z'),
      },
      fetchWindow: async (start, end) => {
        fetchedWindow = [start.toISOString(), end.toISOString()];
        return sourceResult();
      },
      persistEvents: async () => ({
        inserted: 1,
        updated: 0,
        unchanged: 0,
        batches: 1,
      }),
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      windowKind: 'backfill',
      windowStart: '2026-09-01T00:00:00.000Z',
      windowEnd: '2026-09-02T00:00:00.000Z',
    });
    expect(fetchedWindow).toEqual([
      '2026-09-01T00:00:00.000Z',
      '2026-09-02T00:00:00.000Z',
    ]);
    expect(
      database.batches
        .flat()
        .some((statement) =>
          statement.sql.includes('INSERT INTO ingestion_state'),
        ),
    ).toBe(false);
    expect(
      database.batches
        .flat()
        .some((statement) =>
          statement.sql.includes('INSERT INTO source_health'),
        ),
    ).toBe(false);
    expect(
      database.runStatements.find((statement) =>
        statement.sql.includes('INSERT INTO ingestion_runs'),
      )?.bindings[3],
    ).toBe('backfill');
    expect(
      database.batches
        .flat()
        .some((statement) =>
          statement.sql.includes('INSERT INTO source_request_control'),
        ),
    ).toBe(true);
  });

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
