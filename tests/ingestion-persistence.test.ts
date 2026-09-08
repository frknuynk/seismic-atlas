import { describe, expect, it } from 'vitest';
import type { NormalizedSourceEvent } from '@/shared/schemas';
import { persistEventsInBatches } from '@/worker/ingestion/persistence';

type ExistingRow = {
  id: string;
  source_event_id: string;
  payload_hash: string;
};

type CapturedStatement = {
  sql: string;
  bindings: unknown[];
};

function persistenceDatabase(
  existingRows: ExistingRow[] = [],
  failBatch?: number,
) {
  const batches: CapturedStatement[][] = [];
  let reads = 0;

  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          const statement: CapturedStatement & {
            all: () => Promise<{ results: ExistingRow[] }>;
          } = {
            sql,
            bindings,
            async all() {
              reads += 1;
              return { results: existingRows };
            },
          };
          return statement;
        },
      };
    },
    async batch(statements: CapturedStatement[]) {
      batches.push(statements);
      if (failBatch === batches.length) {
        throw new Error('simulated D1 batch failure');
      }
      return [];
    },
  } as unknown as D1Database;

  return {
    db,
    batches,
    get reads() {
      return reads;
    },
  };
}

function event(index: number): NormalizedSourceEvent {
  return {
    source: 'AFAD',
    sourceEventId: `event-${index}`,
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
}

function upsertRows(statement: CapturedStatement) {
  return JSON.parse(String(statement.bindings[1])) as Array<{
    sourceEventId: string;
    payloadHash: string;
  }>;
}

describe('D1 ingestion persistence', () => {
  it('persists 2,500 events with one lookup and three bounded transactions', async () => {
    const database = persistenceDatabase();
    let heartbeats = 0;

    const result = await persistEventsInBatches(
      database.db,
      Array.from({ length: 2_500 }, (_, index) => event(index)),
      Date.parse('2026-09-08T12:05:00.000Z'),
      {
        beforeBatch: async () => {
          heartbeats += 1;
        },
      },
    );

    expect(result).toEqual({
      inserted: 2_500,
      updated: 0,
      unchanged: 0,
      batches: 3,
    });
    expect(database.reads).toBe(1);
    expect(database.batches).toHaveLength(3);
    expect(database.batches.map((batch) => batch.length)).toEqual([2, 2, 2]);
    expect(
      database.batches
        .map((batch) => upsertRows(batch[0]))
        .map((rows) => rows.length),
    ).toEqual([1_000, 1_000, 500]);
    expect(heartbeats).toBe(3);
  });

  it('classifies unchanged and revised events before writing revisions', async () => {
    const initialDatabase = persistenceDatabase();
    const events = [event(1), event(2), event(3)];
    await persistEventsInBatches(initialDatabase.db, events, 1, {
      maxEventsPerBatch: 2,
    });
    const firstRows = initialDatabase.batches.flatMap((batch) =>
      upsertRows(batch[0]),
    );
    const hashById = new Map(
      firstRows.map((row) => [row.sourceEventId, row.payloadHash] as const),
    );
    const existingRows = events.map((item) => ({
      id: `AFAD:${item.sourceEventId}`,
      source_event_id: item.sourceEventId,
      payload_hash:
        item.sourceEventId === 'event-2'
          ? 'outdated-hash'
          : (hashById.get(item.sourceEventId) ?? ''),
    }));
    const database = persistenceDatabase(existingRows);

    const result = await persistEventsInBatches(database.db, events, 2, {
      maxEventsPerBatch: 2,
    });

    expect(result).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: 2,
      batches: 2,
    });
    expect(database.batches[0]).toHaveLength(2);
    expect(database.batches[1]).toHaveLength(1);
  });

  it('stops before later batches when D1 rejects a transaction', async () => {
    const database = persistenceDatabase([], 2);
    const committedBatches: number[] = [];

    await expect(
      persistEventsInBatches(database.db, [event(1), event(2), event(3)], 1, {
        maxEventsPerBatch: 1,
        onBatchCommitted: (count) => {
          committedBatches.push(count);
        },
      }),
    ).rejects.toThrow('simulated D1 batch failure');

    expect(database.batches).toHaveLength(2);
    expect(committedBatches).toEqual([1]);
  });
});
