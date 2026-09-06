import type { NormalizedSourceEvent } from '@/shared/schemas';
import { fetchAfadWindow } from '@/worker/sources/afad';

const SOURCE = 'AFAD';
const ADAPTER_VERSION = 'afad-v1';

type ExistingEvent = {
  id: string;
  payload_hash: string;
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

async function recordFailure(db: D1Database, attemptedAt: number) {
  await db
    .prepare(
      `INSERT INTO source_health (
        source, last_attempt_at, consecutive_failures, status
      ) VALUES (?, ?, 1, 'error')
      ON CONFLICT(source) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at,
        consecutive_failures = source_health.consecutive_failures + 1,
        status = 'error'`,
    )
    .bind(SOURCE, attemptedAt)
    .run();
}

export async function runAfadSync(
  db: D1Database,
  options: { now?: Date; windowMinutes?: number } = {},
) {
  const now = options.now ?? new Date();
  const windowMinutes = options.windowMinutes ?? 7 * 24 * 60;
  const start = new Date(now.valueOf() - windowMinutes * 60_000);
  const observedAt = now.valueOf();

  try {
    const events = await fetchAfadWindow(start, now);
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const event of events) {
      const result = await persistEvent(db, event, observedAt);
      if (result === 'inserted') inserted += 1;
      if (result === 'updated') updated += 1;
      if (result === 'unchanged') unchanged += 1;
    }

    const latestEventTime = events.reduce<number | null>((latest, event) => {
      const time = Date.parse(event.originTime);
      return latest === null || time > latest ? time : latest;
    }, null);

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
        .bind(SOURCE, observedAt, observedAt, latestEventTime),
      db
        .prepare(
          `INSERT INTO ingestion_state (
            source, last_success_window_end, adapter_version
          ) VALUES (?, ?, ?)
          ON CONFLICT(source) DO UPDATE SET
            last_success_window_end = excluded.last_success_window_end,
            adapter_version = excluded.adapter_version`,
        )
        .bind(SOURCE, observedAt, ADAPTER_VERSION),
    ]);

    return { fetched: events.length, inserted, updated, unchanged };
  } catch (error) {
    await recordFailure(db, observedAt);
    throw error;
  }
}
