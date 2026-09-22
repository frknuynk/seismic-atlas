import { runAfadSync } from '@/worker/ingestion/afad';
import { logEvent, serializeError } from '@/worker/observability';

type ScheduledSyncRunner = (
  db: D1Database,
  options: { trigger: 'scheduled' },
) => ReturnType<typeof runAfadSync>;

export async function runObservedScheduledAfadSync(
  db: D1Database,
  options: {
    scheduledTime: number;
    correlationId?: string;
    clock?: () => number;
    runSync?: ScheduledSyncRunner;
  },
) {
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const clock = options.clock ?? Date.now;
  const runSync = options.runSync ?? runAfadSync;
  const startedAt = clock();

  logEvent('info', 'cron.afad_sync.started', {
    correlationId,
    scheduledTime: new Date(options.scheduledTime).toISOString(),
  });

  try {
    const result = await runSync(db, { trigger: 'scheduled' });
    logEvent(
      result.status === 'succeeded' ? 'info' : 'warn',
      'cron.afad_sync.completed',
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
    logEvent('error', 'cron.afad_sync.failed', {
      correlationId,
      durationMs: Math.max(0, clock() - startedAt),
      error: serializeError(error),
    });
    throw error;
  }
}
