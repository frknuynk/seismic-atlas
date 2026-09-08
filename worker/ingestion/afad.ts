import {
  AfadSourceError,
  fetchAfadWindowWithDiagnostics,
  type AfadFetchProgress,
  type AfadRejectedRecord,
  type AfadWindowResult,
} from '@/worker/sources/afad';
import {
  planAfadSyncWindow,
  type AfadIngestionCursor,
} from '@/worker/ingestion/window';
import {
  persistEventsInBatches,
  type PersistenceCounts,
} from '@/worker/ingestion/persistence';

const SOURCE = 'AFAD';
const ADAPTER_VERSION = 'afad-v3';
const LEASE_DURATION_MS = 10 * 60_000;
const LEASE_HEARTBEAT_INTERVAL_MS = 60_000;

type IngestionStateRow = {
  last_success_window_end: number | null;
  last_full_reconcile_at: number | null;
};

type RunAfadSyncOptions = {
  now?: Date;
  windowMinutes?: number;
  trigger?: 'manual' | 'scheduled';
  clock?: () => number;
  fetchWindow?: typeof fetchAfadWindowWithDiagnostics;
  persistEvents?: typeof persistEventsInBatches;
};

export class IngestionLeaseLostError extends Error {
  readonly code = 'INGESTION_LEASE_LOST';

  constructor(
    readonly attempts: number,
    readonly splits: number,
  ) {
    super('AFAD ingestion no longer owns its synchronization lease.');
    this.name = 'IngestionLeaseLostError';
  }
}

async function acquireLease(db: D1Database, runId: string, acquiredAt: number) {
  const result = await db
    .prepare(
      `INSERT INTO ingestion_leases (source, run_id, acquired_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        run_id = excluded.run_id,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
      WHERE ingestion_leases.expires_at <= excluded.acquired_at`,
    )
    .bind(SOURCE, runId, acquiredAt, acquiredAt + LEASE_DURATION_MS)
    .run();

  return result.meta.changes > 0;
}

async function renewLease(db: D1Database, runId: string, renewedAt: number) {
  const result = await db
    .prepare(
      `UPDATE ingestion_leases
      SET expires_at = ?
      WHERE source = ? AND run_id = ? AND expires_at > ?`,
    )
    .bind(renewedAt + LEASE_DURATION_MS, SOURCE, runId, renewedAt)
    .run();

  return result.meta.changes === 1;
}

async function recoverStaleRuns(
  db: D1Database,
  currentRunId: string,
  recoveredAt: number,
) {
  await db
    .prepare(
      `UPDATE ingestion_runs SET
        status = 'failed',
        completed_at = ?,
        error_code = 'INGESTION_LEASE_EXPIRED',
        error_message = 'The worker stopped before releasing its ingestion lease.'
      WHERE source = ? AND status = 'running' AND id != ?`,
    )
    .bind(recoveredAt, SOURCE, currentRunId)
    .run();
}

async function releaseLease(db: D1Database, runId: string) {
  await db
    .prepare(
      `DELETE FROM ingestion_leases
      WHERE source = ? AND run_id = ?`,
    )
    .bind(SOURCE, runId)
    .run();
}

function createLeaseHeartbeat({
  db,
  runId,
  startedAt,
  clock,
  diagnostics,
}: {
  db: D1Database;
  runId: string;
  startedAt: number;
  clock: () => number;
  diagnostics: () => { attempts: number; splits: number };
}) {
  let lastRenewedAt = startedAt;

  return async (force = false) => {
    const renewedAt = clock();
    if (!force && renewedAt - lastRenewedAt < LEASE_HEARTBEAT_INTERVAL_MS) {
      return;
    }

    const renewed = await renewLease(db, runId, renewedAt);
    if (!renewed) {
      const { attempts, splits } = diagnostics();
      throw new IngestionLeaseLostError(attempts, splits);
    }
    lastRenewedAt = renewedAt;
  };
}

function errorDiagnostic(
  error: unknown,
  progress: { attempts: number; splits: number },
) {
  if (
    error instanceof AfadSourceError ||
    error instanceof IngestionLeaseLostError
  ) {
    return {
      code: error.code,
      message: error.message.slice(0, 500),
      attempts: error.attempts,
      splits: error.splits,
    };
  }

  return {
    code: 'AFAD_SYNC_INTERNAL_ERROR',
    message: 'The synchronization failed during local processing.',
    attempts: progress.attempts,
    splits: progress.splits,
  };
}

function rejectionStatement(
  db: D1Database,
  runId: string,
  rejections: AfadRejectedRecord[],
  observedAt: number,
) {
  return db
    .prepare(
      `INSERT INTO ingestion_rejections (
        run_id, source, source_event_id, reason, observed_at, raw_json
      )
      SELECT
        ?,
        ?,
        json_extract(rejection.value, '$.sourceEventId'),
        json_extract(rejection.value, '$.reason'),
        ?,
        json_extract(rejection.value, '$.rawJson')
      FROM json_each(?) AS rejection`,
    )
    .bind(runId, SOURCE, observedAt, JSON.stringify(rejections));
}

export async function runAfadSync(
  db: D1Database,
  options: RunAfadSyncOptions = {},
) {
  const clock = options.clock ?? Date.now;
  const now = options.now ?? new Date(clock());
  const startedAt = now.valueOf();
  const runId = crypto.randomUUID();
  const trigger = options.trigger ?? 'manual';
  const fetchWindow = options.fetchWindow ?? fetchAfadWindowWithDiagnostics;
  const persistEvents = options.persistEvents ?? persistEventsInBatches;
  let leaseAcquired = false;
  let runRecorded = false;
  let committedWriteBatches = 0;
  let sourceResult: AfadWindowResult | null = null;
  let sourceProgress: AfadFetchProgress = { attempts: 0, splits: 0 };
  const heartbeat = createLeaseHeartbeat({
    db,
    runId,
    startedAt,
    clock,
    diagnostics: () => ({
      attempts: sourceResult?.attempts ?? sourceProgress.attempts,
      splits: sourceResult?.splits ?? sourceProgress.splits,
    }),
  });

  try {
    leaseAcquired = await acquireLease(db, runId, startedAt);
    if (!leaseAcquired) {
      return {
        runId,
        status: 'skipped' as const,
        reason: 'sync_in_progress' as const,
      };
    }

    await recoverStaleRuns(db, runId, startedAt);

    const state = await db
      .prepare(
        `SELECT last_success_window_end, last_full_reconcile_at
        FROM ingestion_state
        WHERE source = ?`,
      )
      .bind(SOURCE)
      .first<IngestionStateRow>();
    const cursor: AfadIngestionCursor = state
      ? {
          lastSuccessWindowEnd: state.last_success_window_end,
          lastFullReconcileAt: state.last_full_reconcile_at,
        }
      : null;
    const window = planAfadSyncWindow({
      now,
      trigger,
      cursor,
      requestedWindowMinutes: options.windowMinutes,
    });

    await db
      .prepare(
        `INSERT INTO ingestion_runs (
          id, source, trigger, window_kind, status, window_start, window_end,
          started_at
        ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .bind(
        runId,
        SOURCE,
        trigger,
        window.kind,
        window.start.valueOf(),
        window.end.valueOf(),
        startedAt,
      )
      .run();
    runRecorded = true;

    sourceResult = await fetchWindow(window.start, window.end, fetch, {
      beforeRequest: async (progress) => {
        sourceProgress = progress;
        await heartbeat();
      },
    });
    await heartbeat(true);
    const persistence: PersistenceCounts = await persistEvents(
      db,
      sourceResult.events,
      startedAt,
      {
        beforeBatch: () => heartbeat(),
        onBatchCommitted: (batches) => {
          committedWriteBatches = batches;
        },
      },
    );

    const latestEventTime = sourceResult.events.reduce<number | null>(
      (latest, event) => {
        const time = Date.parse(event.originTime);
        return latest === null || time > latest ? time : latest;
      },
      null,
    );
    await heartbeat(true);
    const completedAt = clock();

    const successStatements = [
      db
        .prepare(
          `INSERT INTO source_health (
            source, last_attempt_at, last_success_at, latest_event_time,
            consecutive_failures, status
          ) VALUES (?, ?, ?, ?, 0, 'ok')
          ON CONFLICT(source) DO UPDATE SET
            last_attempt_at = excluded.last_attempt_at,
            last_success_at = excluded.last_success_at,
            latest_event_time = COALESCE(excluded.latest_event_time, source_health.latest_event_time),
            consecutive_failures = 0,
            status = 'ok'`,
        )
        .bind(SOURCE, startedAt, completedAt, latestEventTime),
      db
        .prepare(
          `INSERT INTO ingestion_state (
            source, last_success_window_end, last_full_reconcile_at,
            adapter_version
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(source) DO UPDATE SET
            last_success_window_end = excluded.last_success_window_end,
            last_full_reconcile_at = COALESCE(
              excluded.last_full_reconcile_at,
              ingestion_state.last_full_reconcile_at
            ),
            adapter_version = excluded.adapter_version`,
        )
        .bind(
          SOURCE,
          window.end.valueOf(),
          window.fullReconcile ? completedAt : null,
          ADAPTER_VERSION,
        ),
      db
        .prepare(
          `UPDATE ingestion_runs SET
            status = 'succeeded', completed_at = ?, attempts = ?, splits = ?,
            write_batches = ?, fetched = ?, accepted = ?, rejected = ?,
            duplicates_dropped = ?, inserted = ?, updated = ?, unchanged = ?
          WHERE id = ?`,
        )
        .bind(
          completedAt,
          sourceResult.attempts,
          sourceResult.splits,
          persistence.batches,
          sourceResult.received,
          sourceResult.events.length,
          sourceResult.rejected,
          sourceResult.duplicatesDropped,
          persistence.inserted,
          persistence.updated,
          persistence.unchanged,
          runId,
        ),
    ];
    if (sourceResult.rejections.length > 0) {
      successStatements.push(
        rejectionStatement(db, runId, sourceResult.rejections, completedAt),
      );
    }
    await db.batch(successStatements);

    return {
      runId,
      status: 'succeeded' as const,
      windowKind: window.kind,
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      attempts: sourceResult.attempts,
      splits: sourceResult.splits,
      fetched: sourceResult.received,
      accepted: sourceResult.events.length,
      rejected: sourceResult.rejected,
      duplicatesDropped: sourceResult.duplicatesDropped,
      inserted: persistence.inserted,
      updated: persistence.updated,
      unchanged: persistence.unchanged,
      writeBatches: persistence.batches,
      durationMs: Math.max(0, completedAt - startedAt),
    };
  } catch (error) {
    const diagnostic = errorDiagnostic(error, {
      attempts: sourceResult?.attempts ?? sourceProgress.attempts,
      splits: sourceResult?.splits ?? sourceProgress.splits,
    });
    const completedAt = clock();
    try {
      const statements: D1PreparedStatement[] = [];
      if (!(error instanceof IngestionLeaseLostError)) {
        statements.push(
          db
            .prepare(
              `INSERT INTO source_health (
              source, last_attempt_at, consecutive_failures, status
            ) VALUES (?, ?, 1, 'error')
            ON CONFLICT(source) DO UPDATE SET
              last_attempt_at = excluded.last_attempt_at,
              consecutive_failures = source_health.consecutive_failures + 1,
              status = 'error'`,
            )
            .bind(SOURCE, completedAt),
        );
      }
      if (runRecorded) {
        statements.push(
          db
            .prepare(
              `UPDATE ingestion_runs SET
                status = 'failed', completed_at = ?, attempts = ?, splits = ?,
                write_batches = ?, error_code = ?, error_message = ?
              WHERE id = ?`,
            )
            .bind(
              completedAt,
              diagnostic.attempts,
              diagnostic.splits,
              committedWriteBatches,
              diagnostic.code,
              diagnostic.message,
              runId,
            ),
        );
        if (error instanceof AfadSourceError) {
          if (error.rejections.length > 0) {
            statements.push(
              rejectionStatement(db, runId, error.rejections, completedAt),
            );
          }
        }
      }
      if (statements.length > 0) await db.batch(statements);
    } catch (auditError) {
      console.error('AFAD sync failure could not be recorded', auditError);
    }
    throw error;
  } finally {
    if (leaseAcquired) {
      try {
        await releaseLease(db, runId);
      } catch (error) {
        console.error('AFAD sync lease could not be released', error);
      }
    }
  }
}
