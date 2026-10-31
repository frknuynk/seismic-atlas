import type { SourceCode } from '@/shared/schemas';
import { runAfadSync } from '@/worker/ingestion/afad';
import { logEvent, serializeError } from '@/worker/observability';
import { pruneRecentAfadCatalog } from '@/worker/catalog-retention';

type ScheduledSyncRunner = (
  db: D1Database,
  options: { trigger: 'scheduled' },
) => Promise<{ runId: string; status: string; reason?: string }>;

export async function runAfadSyncThenRetention<T extends { status: string }>(
  db: D1Database,
  options: {
    runSync: () => Promise<T>;
    retentionNow?: number;
    runRetention?: typeof pruneRecentAfadCatalog;
  },
) {
  const result = await options.runSync();
  if (result.status !== 'succeeded') return { result, retention: null };

  const retention = await (options.runRetention ?? pruneRecentAfadCatalog)(
    db,
    options.retentionNow,
  );
  logEvent('info', 'catalog.retention.completed', retention);
  return { result, retention };
}

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
  return runObservedScheduledSourceSync(
    db,
    'AFAD',
    async (database, syncOptions) => {
      const { result } = await runAfadSyncThenRetention(database, {
        retentionNow: options.scheduledTime,
        runRetention: options.runRetention,
        runSync: () => (options.runSync ?? runAfadSync)(database, syncOptions),
      });
      return result;
    },
    options,
  );
}
