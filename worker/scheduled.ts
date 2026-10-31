import type { SourceCode } from '@/shared/schemas';
import { runAfadSync } from '@/worker/ingestion/afad';
import { logEvent, serializeError } from '@/worker/observability';
import { pruneRecentAfadCatalog } from '@/worker/catalog-retention';

type ScheduledSyncRunner = (
  db: D1Database,
  options: { trigger: 'scheduled' },
) => Promise<{ runId: string; status: string; reason?: string }>;

export async function runObservedScheduledSourceSync(
  db: D1Database,
  source: SourceCode,
  runSync: ScheduledSyncRunner,
  options: {
    scheduledTime: number;
    correlationId?: string;
    clock?: () => number;
  },
) {
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const eventPrefix = `cron.${source.toLowerCase()}_sync`;

  logEvent('info', `${eventPrefix}.started`, {
    correlationId,
    scheduledTime: new Date(options.scheduledTime).toISOString(),
  });

  try {
    const result = await runSync(db, { trigger: 'scheduled' });
    logEvent(
      result.status === 'succeeded' ? 'info' : 'warn',
      `${eventPrefix}.completed`,
      {
        correlationId,
        runId: result.runId,
        status: result.status,
        durationMs: Math.max(0, clock() - startedAt),
        reason: 'reason' in result ? result.reason : null,
      },
    );
    return result;
  } catch (error) {
    logEvent('error', `${eventPrefix}.failed`, {
      correlationId,
      durationMs: Math.max(0, clock() - startedAt),
      error: serializeError(error),
    });
    throw error;
  }
}

export function runObservedScheduledAfadSync(
  db: D1Database,
  options: {
    scheduledTime: number;
    correlationId?: string;
    clock?: () => number;
    runSync?: ScheduledSyncRunner;
    runRetention?: typeof pruneRecentAfadCatalog;
  },
) {
  const runRetention = options.runRetention ?? pruneRecentAfadCatalog;
  return runRetention(db, options.scheduledTime).then((retention) => {
    logEvent('info', 'catalog.retention.completed', retention);
    return runObservedScheduledSourceSync(
      db,
      'AFAD',
      options.runSync ?? runAfadSync,
      options,
    );
  });
}
