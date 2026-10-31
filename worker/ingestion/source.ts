import type { NormalizedSourceEvent, SourceCode } from '@/shared/schemas';
import {
  planSourceBackfillWindow,
  planSourceSyncWindow,
  type SourceIngestionCursor,
} from '@/worker/ingestion/window';
import {
  persistEventsInBatches,
  type PersistenceCounts,
} from '@/worker/ingestion/persistence';
import {
  planSourceCircuitFailure,
  sourceCircuitFailureStatement,
  sourceCircuitGate,
  sourceCircuitSuccessStatement,
} from '@/worker/ingestion/source-control';
import { logEvent, serializeError } from '@/worker/observability';
import type {
  SourceFetchProgress,
  SourceRejectedRecord,
  SourceWindowResult,
} from '@/worker/sources/fdsn';

const LEASE_DURATION_MS = 10 * 60_000;
const LEASE_HEARTBEAT_INTERVAL_MS = 60_000;

type IngestionStateRow = {
  last_success_window_end: number | null;
  last_full_reconcile_at: number | null;
};

type SourceError = Error & {
  code: string;
  attempts: number;
  rejections: SourceRejectedRecord[];
  splits: number;
  retryAfterMs: number | null;
};

type FetchWindow = (
  start: Date,
  end: Date,
  fetcher: typeof fetch,
  options: {
    beforeRequest?: (progress: SourceFetchProgress) => Promise<void>;
  },
) => Promise<SourceWindowResult>;

export type SourceSyncConfig = {
  source: SourceCode;
  adapterVersion: string;
  fetchWindow: FetchWindow;
  isSourceError: (error: unknown) => error is SourceError;
  afterPersist?: (
    db: D1Database,
    events: NormalizedSourceEvent[],
    observedAt: number,
  ) => Promise<void>;
};

export type RunSourceSyncOptions = {
  now?: Date;
  windowMinutes?: number;
  backfillWindow?: { start: Date; end: Date };
  trigger?: 'manual' | 'scheduled';
  clock?: () => number;
  fetchWindow?: FetchWindow;
  persistEvents?: typeof persistEventsInBatches;
};

export class IngestionLeaseLostError extends Error {
  readonly code = 'INGESTION_LEASE_LOST';

  constructor(
    readonly source: SourceCode,
    readonly attempts: number,
    readonly splits: number,
  ) {
    super(`${source} ingestion no longer owns its synchronization lease.`);
    this.name = 'IngestionLeaseLostError';
  }
}

async function acquireLease(
  db: D1Database,
  source: SourceCode,
  runId: string,
  acquiredAt: number,
) {
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
    .bind(source, runId, acquiredAt, acquiredAt + LEASE_DURATION_MS)
    .run();
  return result.meta.changes > 0;
}

async function renewLease(
  db: D1Database,
  source: SourceCode,
  runId: string,
  renewedAt: number,
) {
  const result = await db
    .prepare(
      `UPDATE ingestion_leases
      SET expires_at = ?
      WHERE source = ? AND run_id = ? AND expires_at > ?`,
    )
    .bind(renewedAt + LEASE_DURATION_MS, source, runId, renewedAt)
    .run();
  return result.meta.changes === 1;
}

async function recoverStaleRuns(
  db: D1Database,
  source: SourceCode,
  currentRunId: string,
  recoveredAt: number,
) {
  await db
    .prepare(
      `UPDATE ingestion_runs SET
        status = 'failed', completed_at = ?,
        error_code = 'INGESTION_LEASE_EXPIRED',
        error_message = 'The worker stopped before releasing its ingestion lease.'
      WHERE source = ? AND status = 'running' AND id != ?`,
    )
    .bind(recoveredAt, source, currentRunId)
    .run();
}

async function releaseLease(
  db: D1Database,
  source: SourceCode,
  runId: string,
) {
  await db
    .prepare(`DELETE FROM ingestion_leases WHERE source = ? AND run_id = ?`)
    .bind(source, runId)
    .run();
}

function rejectionStatement(
  db: D1Database,
  source: SourceCode,
  runId: string,
  rejections: SourceRejectedRecord[],
  observedAt: number,
) {
  return db
    .prepare(
      `INSERT INTO ingestion_rejections (
        run_id, source, source_event_id, reason, observed_at, raw_json
      )
      SELECT ?, ?, json_extract(rejection.value, '$.sourceEventId'),
        json_extract(rejection.value, '$.reason'), ?,
        json_extract(rejection.value, '$.rawJson')
      FROM json_each(?) AS rejection`,
    )
    .bind(runId, source, observedAt, JSON.stringify(rejections));
}

export async function runSourceSync(
  db: D1Database,
  config: SourceSyncConfig,
  options: RunSourceSyncOptions = {},
) {
  const { source } = config;
  const clock = options.clock ?? Date.now;
  const now = options.now ?? new Date(clock());
  const startedAt = now.valueOf();
  const runId = crypto.randomUUID();
  const trigger = options.trigger ?? 'manual';
  const fetchWindow = options.fetchWindow ?? config.fetchWindow;
  const persistEvents = options.persistEvents ?? persistEventsInBatches;
  const plannedBackfill = options.backfillWindow
    ? planSourceBackfillWindow({ ...options.backfillWindow, now })
    : null;
  let leaseAcquired = false;
  let runRecorded = false;
  let committedWriteBatches = 0;
  let sourceResult: SourceWindowResult | null = null;
  let sourceProgress: SourceFetchProgress = { attempts: 0, splits: 0 };
  let previousSourceFailures = 0;
  let lastLeaseRenewal = startedAt;

  const heartbeat = async (force = false) => {
    const renewedAt = clock();
    if (!force && renewedAt - lastLeaseRenewal < LEASE_HEARTBEAT_INTERVAL_MS) {
      return;
    }
    const renewed = await renewLease(db, source, runId, renewedAt);
    if (!renewed) {
      throw new IngestionLeaseLostError(
        source,
        sourceResult?.attempts ?? sourceProgress.attempts,
        sourceResult?.splits ?? sourceProgress.splits,
      );
    }
    lastLeaseRenewal = renewedAt;
  };

  try {
    const circuit = await sourceCircuitGate(db, source, startedAt);
    previousSourceFailures = circuit.consecutiveFailures;
    if (!circuit.allowed) {
      return {
        runId,
        status: 'skipped' as const,
        reason: 'source_circuit_open' as const,
        retryAt: new Date(circuit.retryAt).toISOString(),
        errorCode: circuit.reason,
      };
    }

    leaseAcquired = await acquireLease(db, source, runId, startedAt);
    if (!leaseAcquired) {
      return {
        runId,
        status: 'skipped' as const,
        reason: 'sync_in_progress' as const,
      };
    }
    await recoverStaleRuns(db, source, runId, startedAt);

    const state = plannedBackfill
      ? null
      : await db
          .prepare(
            `SELECT last_success_window_end, last_full_reconcile_at
            FROM ingestion_state WHERE source = ?`,
          )
          .bind(source)
          .first<IngestionStateRow>();
    const cursor: SourceIngestionCursor = state
      ? {
          lastSuccessWindowEnd: state.last_success_window_end,
          lastFullReconcileAt: state.last_full_reconcile_at,
        }
      : null;
    const window =
      plannedBackfill ??
      planSourceSyncWindow({
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
        source,
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
    await config.afterPersist?.(db, sourceResult.events, startedAt);

    const latestEventTime = sourceResult.events.reduce<number | null>(
      (latest, event) => {
        const time = Date.parse(event.originTime);
        return latest === null || time > latest ? time : latest;
      },
      null,
    );
    await heartbeat(true);
    const completedAt = clock();
    const statements = [
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
      sourceCircuitSuccessStatement(db, source, completedAt),
    ];
    if (window.kind !== 'backfill') {
      statements.unshift(
        db
          .prepare(
            `INSERT INTO source_health (
              source, last_attempt_at, last_success_at, latest_event_time,
              consecutive_failures, status
            ) VALUES (?, ?, ?, ?, 0, 'ok')
            ON CONFLICT(source) DO UPDATE SET
              last_attempt_at = excluded.last_attempt_at,
              last_success_at = excluded.last_success_at,
              latest_event_time = CASE
                WHEN excluded.latest_event_time IS NULL THEN source_health.latest_event_time
                WHEN source_health.latest_event_time IS NULL THEN excluded.latest_event_time
                WHEN excluded.latest_event_time > source_health.latest_event_time THEN excluded.latest_event_time
                ELSE source_health.latest_event_time
              END,
              consecutive_failures = 0,
              status = 'ok'`,
          )
          .bind(source, startedAt, completedAt, latestEventTime),
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
            source,
            window.end.valueOf(),
            window.fullReconcile ? completedAt : null,
            config.adapterVersion,
          ),
      );
    }
    if (sourceResult.rejections.length > 0) {
      statements.push(
        rejectionStatement(
          db,
          source,
          runId,
          sourceResult.rejections,
          completedAt,
        ),
      );
    }
    await db.batch(statements);

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
    const sourceError = config.isSourceError(error) ? error : null;
    const leaseError = error instanceof IngestionLeaseLostError ? error : null;
    const diagnostic = {
      code:
        sourceError?.code ??
        leaseError?.code ??
        `${source}_SYNC_INTERNAL_ERROR`,
      message:
        sourceError?.message.slice(0, 500) ??
        leaseError?.message.slice(0, 500) ??
        'The synchronization failed during local processing.',
      attempts:
        sourceError?.attempts ??
        leaseError?.attempts ??
        sourceResult?.attempts ??
        sourceProgress.attempts,
      splits:
        sourceError?.splits ??
        leaseError?.splits ??
        sourceResult?.splits ??
        sourceProgress.splits,
    };
    const completedAt = clock();
    try {
      const statements: D1PreparedStatement[] = [];
      if (!leaseError && !plannedBackfill) {
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
            .bind(source, completedAt),
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
        if (sourceError?.rejections.length) {
          statements.push(
            rejectionStatement(
              db,
              source,
              runId,
              sourceError.rejections,
              completedAt,
            ),
          );
        }
      }
      if (sourceError) {
        const circuitFailure = planSourceCircuitFailure({
          error: sourceError,
          previousFailures: previousSourceFailures,
          now: completedAt,
        });
        if (circuitFailure) {
          statements.push(
            sourceCircuitFailureStatement(
              db,
              source,
              circuitFailure,
              completedAt,
            ),
          );
        }
      }
      if (statements.length > 0) await db.batch(statements);
    } catch (auditError) {
      logEvent('error', `ingestion.${source.toLowerCase()}.failure_audit_failed`, {
        runId,
        error: serializeError(auditError),
      });
    }
    throw error;
  } finally {
    if (leaseAcquired) {
      try {
        await releaseLease(db, source, runId);
      } catch (error) {
        logEvent('error', `ingestion.${source.toLowerCase()}.lease_release_failed`, {
          runId,
          error: serializeError(error),
        });
      }
    }
  }
}
