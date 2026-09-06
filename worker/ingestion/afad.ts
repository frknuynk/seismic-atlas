import type { NormalizedSourceEvent } from '@/shared/schemas';
import {
  AfadSourceError,
  fetchAfadWindowWithDiagnostics,
  type AfadRejectedRecord,
} from '@/worker/sources/afad';
import {
  planAfadSyncWindow,
  type AfadIngestionCursor,
} from '@/worker/ingestion/window';

const SOURCE = 'AFAD';
const ADAPTER_VERSION = 'afad-v2';
const LEASE_DURATION_MS = 10 * 60_000;

type ExistingEvent = {
  id: string;
  payload_hash: string;
};

type IngestionStateRow = {
  last_success_window_end: number | null;
  last_full_reconcile_at: number | null;
};

async function payloadHash(event: NormalizedSourceEvent) {
  const canonical = JSON.stringify({
    sourceEventId: event.sourceEventId,
    originTime: event.originTime,
    latitude: event.latitude,
    longitude: event.longitude,
    depthKm: event.depthKm,
    magnitude: event.magnitude,
    magnitudeType: event.magnitudeType,
    placeRaw: event.placeRaw,
    sourceStatus: event.sourceStatus,
    sourceUpdatedAt: event.sourceUpdatedAt,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function persistEvent(
  db: D1Database,
  event: NormalizedSourceEvent,
  observedAt: number,
) {
  const id = `${SOURCE}:${event.sourceEventId}`;
  const hash = await payloadHash(event);
  const existing = await db
    .prepare(
      `SELECT id, payload_hash
      FROM source_events
      WHERE source = ? AND source_event_id = ?`,
    )
    .bind(SOURCE, event.sourceEventId)
    .first<ExistingEvent>();

  if (existing?.payload_hash === hash) {
    await db
      .prepare('UPDATE source_events SET last_seen_at = ? WHERE id = ?')
      .bind(observedAt, existing.id)
      .run();
    return 'unchanged' as const;
  }

  const sourceUpdatedAt = event.sourceUpdatedAt
    ? Date.parse(event.sourceUpdatedAt)
    : null;
  const values = [
    Date.parse(event.originTime),
    event.latitude,
    event.longitude,
    event.depthKm,
    event.magnitude,
    event.magnitudeType,
    event.placeRaw,
    event.sourceStatus,
    sourceUpdatedAt,
  ] as const;

  if (!existing) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO source_events (
            id, source, source_event_id, origin_time, latitude, longitude,
            depth_km, magnitude, magnitude_type, place_raw, source_status,
            source_updated_at, first_seen_at, last_seen_at, payload_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          SOURCE,
          event.sourceEventId,
          ...values,
          observedAt,
          observedAt,
          hash,
        ),
      db
        .prepare(
          `INSERT INTO source_event_revisions (
            source_event_pk, revision_no, payload_hash, observed_at,
            source_updated_at, origin_time, latitude, longitude, depth_km,
            magnitude, magnitude_type, place_raw, raw_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          1,
          hash,
          observedAt,
          sourceUpdatedAt,
          Date.parse(event.originTime),
          event.latitude,
          event.longitude,
          event.depthKm,
          event.magnitude,
          event.magnitudeType,
          event.placeRaw,
          JSON.stringify(event),
        ),
    ]);
    return 'inserted' as const;
  }

  const revision = await db
    .prepare(
      `SELECT COALESCE(MAX(revision_no), 0) + 1 AS next_revision
      FROM source_event_revisions
      WHERE source_event_pk = ?`,
    )
    .bind(existing.id)
    .first<{ next_revision: number }>();

  await db.batch([
    db
      .prepare(
        `UPDATE source_events SET
          origin_time = ?, latitude = ?, longitude = ?, depth_km = ?,
          magnitude = ?, magnitude_type = ?, place_raw = ?, source_status = ?,
          source_updated_at = ?, last_seen_at = ?, payload_hash = ?
        WHERE id = ?`,
      )
      .bind(...values, observedAt, hash, existing.id),
    db
      .prepare(
        `INSERT INTO source_event_revisions (
          source_event_pk, revision_no, payload_hash, observed_at,
          source_updated_at, origin_time, latitude, longitude, depth_km,
          magnitude, magnitude_type, place_raw, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        existing.id,
        revision?.next_revision ?? 1,
        hash,
        observedAt,
        sourceUpdatedAt,
        Date.parse(event.originTime),
        event.latitude,
        event.longitude,
        event.depthKm,
        event.magnitude,
        event.magnitudeType,
        event.placeRaw,
        JSON.stringify(event),
      ),
  ]);
  return 'updated' as const;
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

async function releaseLease(db: D1Database, runId: string, releasedAt: number) {
  await db
    .prepare(
      `UPDATE ingestion_leases
      SET expires_at = ?
      WHERE source = ? AND run_id = ?`,
    )
    .bind(releasedAt, SOURCE, runId)
    .run();
}

function errorDiagnostic(error: unknown) {
  if (error instanceof AfadSourceError) {
    return {
      code: error.code,
      message: error.message.slice(0, 500),
      attempts: error.attempts,
    };
  }

  return {
    code: 'AFAD_SYNC_INTERNAL_ERROR',
    message: 'The synchronization failed during local processing.',
    attempts: 0,
  };
}

function rejectionStatement(
  db: D1Database,
  runId: string,
  rejection: AfadRejectedRecord,
  observedAt: number,
) {
  return db
    .prepare(
      `INSERT INTO ingestion_rejections (
        run_id, source, source_event_id, reason, observed_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      runId,
      SOURCE,
      rejection.sourceEventId,
      rejection.reason,
      observedAt,
      rejection.rawJson,
    );
}

export async function runAfadSync(
  db: D1Database,
  options: {
    now?: Date;
    windowMinutes?: number;
    trigger?: 'manual' | 'scheduled';
  } = {},
) {
  const now = options.now ?? new Date();
  const startedAt = now.valueOf();
  const runId = crypto.randomUUID();
  const trigger = options.trigger ?? 'manual';
  let leaseAcquired = false;
  let runRecorded = false;

  try {
    leaseAcquired = await acquireLease(db, runId, startedAt);
    if (!leaseAcquired) {
      return {
        runId,
        status: 'skipped' as const,
        reason: 'sync_in_progress' as const,
      };
    }

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

    const result = await fetchAfadWindowWithDiagnostics(
      window.start,
      window.end,
    );
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const event of result.events) {
      const persistence = await persistEvent(db, event, startedAt);
      if (persistence === 'inserted') inserted += 1;
      if (persistence === 'updated') updated += 1;
      if (persistence === 'unchanged') unchanged += 1;
    }

    const latestEventTime = result.events.reduce<number | null>(
      (latest, event) => {
        const time = Date.parse(event.originTime);
        return latest === null || time > latest ? time : latest;
      },
      null,
    );
    const completedAt = Date.now();

    await db.batch([
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
            status = 'succeeded', completed_at = ?, attempts = ?, fetched = ?,
            accepted = ?, rejected = ?, duplicates_dropped = ?, inserted = ?,
            updated = ?, unchanged = ?
          WHERE id = ?`,
        )
        .bind(
          completedAt,
          result.attempts,
          result.received,
          result.events.length,
          result.rejected,
          result.duplicatesDropped,
          inserted,
          updated,
          unchanged,
          runId,
        ),
      ...result.rejections.map((rejection) =>
        rejectionStatement(db, runId, rejection, completedAt),
      ),
    ]);

    return {
      runId,
      status: 'succeeded' as const,
      windowKind: window.kind,
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      attempts: result.attempts,
      fetched: result.received,
      accepted: result.events.length,
      rejected: result.rejected,
      duplicatesDropped: result.duplicatesDropped,
      inserted,
      updated,
      unchanged,
      durationMs: Math.max(0, completedAt - startedAt),
    };
  } catch (error) {
    const diagnostic = errorDiagnostic(error);
    const completedAt = Date.now();
    try {
      const statements = [
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
      ];
      if (runRecorded) {
        statements.push(
          db
            .prepare(
              `UPDATE ingestion_runs SET
                status = 'failed', completed_at = ?, attempts = ?,
                error_code = ?, error_message = ?
              WHERE id = ?`,
            )
            .bind(
              completedAt,
              diagnostic.attempts,
              diagnostic.code,
              diagnostic.message,
              runId,
            ),
        );
        if (error instanceof AfadSourceError) {
          statements.push(
            ...error.rejections.map((rejection) =>
              rejectionStatement(db, runId, rejection, completedAt),
            ),
          );
        }
      }
      await db.batch(statements);
    } catch (auditError) {
      console.error('AFAD sync failure could not be recorded', auditError);
    }
    throw error;
  } finally {
    if (leaseAcquired) {
      try {
        await releaseLease(db, runId, Date.now());
      } catch (error) {
        console.error('AFAD sync lease could not be released', error);
      }
    }
  }
}
