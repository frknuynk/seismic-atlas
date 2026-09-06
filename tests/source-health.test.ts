import { describe, expect, it } from 'vitest';
import { SourceHealthResponseSchema } from '@/shared/schemas';
import { getSourceHealth } from '@/worker/catalog';

function healthDatabase() {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM source_health')) {
                return {
                  source: 'AFAD',
                  status: 'ok',
                  last_attempt_at: Date.parse('2026-09-06T18:00:00.000Z'),
                  last_success_at: Date.parse('2026-09-06T18:00:01.000Z'),
                  latest_event_time: Date.parse('2026-09-06T17:58:00.000Z'),
                  consecutive_failures: 0,
                };
              }

              return {
                id: 'run-1',
                trigger: 'scheduled',
                window_kind: 'incremental',
                window_start: Date.parse('2026-09-06T17:45:00.000Z'),
                window_end: Date.parse('2026-09-06T18:00:00.000Z'),
                status: 'succeeded',
                started_at: Date.parse('2026-09-06T18:00:00.000Z'),
                completed_at: Date.parse('2026-09-06T18:00:01.000Z'),
                attempts: 2,
                fetched: 120,
                accepted: 118,
                rejected: 1,
                duplicates_dropped: 1,
                inserted: 0,
                updated: 3,
                unchanged: 115,
                error_code: null,
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('source health diagnostics', () => {
  it('reports stale synchronization as delayed with durable run counters', async () => {
    const health = SourceHealthResponseSchema.parse(
      await getSourceHealth(healthDatabase()),
    );

    expect(health.AFAD.status).toBe('delayed');
    expect(health.AFAD.lastRun).toMatchObject({
      id: 'run-1',
      trigger: 'scheduled',
      windowKind: 'incremental',
      windowStart: '2026-09-06T17:45:00.000Z',
      windowEnd: '2026-09-06T18:00:00.000Z',
      status: 'succeeded',
      durationMs: 1_000,
      attempts: 2,
      fetched: 120,
      accepted: 118,
      rejected: 1,
      duplicatesDropped: 1,
      inserted: 0,
      updated: 3,
      unchanged: 115,
      errorCode: null,
    });
  });
});
