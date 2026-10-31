import type { NormalizedSourceEvent, SourceCode } from '@/shared/schemas';

const ASSOCIATION_VERSION = 'space-time-v1';
const MAX_TIME_DELTA_MS = 90_000;
const MAX_DISTANCE_KM = 50;
const MAX_MAGNITUDE_DELTA = 0.8;

type ExistingMembership = {
  canonical_event_id: string;
};

type CandidateRow = {
  canonical_event_id: string;
  preferred_source_event_pk: string;
  source: SourceCode;
  origin_time: number;
  latitude: number;
  longitude: number;
  magnitude: number | null;
};

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function haversineKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitudeA)) *
      Math.cos(radians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sourcePriority(source: SourceCode) {
  if (source === 'AFAD') return 4;
  if (source === 'EMSC') return 3;
  if (source === 'USGS') return 2;
  return 1;
}

async function associateEvent(
  db: D1Database,
  event: NormalizedSourceEvent,
  observedAt: number,
) {
  const sourceEventPk = `${event.source}:${event.sourceEventId}`;
  const existing = await db
    .prepare(
      `SELECT canonical_event_id
      FROM canonical_event_members
      WHERE source_event_pk = ?`,
    )
    .bind(sourceEventPk)
    .first<ExistingMembership>();
  if (existing) {
    await db
      .prepare(
        `UPDATE canonical_events SET updated_at = ? WHERE id = ?`,
      )
      .bind(observedAt, existing.canonical_event_id)
      .run();
    return existing.canonical_event_id;
  }

  const originTime = Date.parse(event.originTime);
  const latitudeWindow = MAX_DISTANCE_KM / 111;
  const longitudeScale = Math.max(
    0.2,
    Math.cos(radians(event.latitude)),
  );
  const longitudeWindow = MAX_DISTANCE_KM / (111 * longitudeScale);
  const candidates = await db
    .prepare(
      `SELECT c.id AS canonical_event_id, c.preferred_source_event_pk,
        e.source, e.origin_time, e.latitude, e.longitude, e.magnitude
      FROM canonical_events c
      INNER JOIN source_events e ON e.id = c.preferred_source_event_pk
      WHERE e.origin_time BETWEEN ? AND ?
        AND e.latitude BETWEEN ? AND ?
        AND e.longitude BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1
          FROM canonical_event_members member
          INNER JOIN source_events member_event
            ON member_event.id = member.source_event_pk
          WHERE member.canonical_event_id = c.id
            AND member_event.source = ?
        )`,
    )
    .bind(
      originTime - MAX_TIME_DELTA_MS,
      originTime + MAX_TIME_DELTA_MS,
      event.latitude - latitudeWindow,
      event.latitude + latitudeWindow,
      event.longitude - longitudeWindow,
      event.longitude + longitudeWindow,
      event.source,
    )
    .all<CandidateRow>();

  const best = candidates.results
    .map((candidate) => {
      const timeDelta = Math.abs(candidate.origin_time - originTime);
      const distance = haversineKm(
        event.latitude,
        event.longitude,
        candidate.latitude,
        candidate.longitude,
      );
      const magnitudeDelta =
        event.magnitude === null || candidate.magnitude === null
          ? null
          : Math.abs(event.magnitude - candidate.magnitude);
      const eligible =
        timeDelta <= MAX_TIME_DELTA_MS &&
        distance <= MAX_DISTANCE_KM &&
        (magnitudeDelta === null || magnitudeDelta <= MAX_MAGNITUDE_DELTA);
      const score =
        timeDelta / MAX_TIME_DELTA_MS +
        distance / MAX_DISTANCE_KM +
        (magnitudeDelta === null
          ? 0.5
          : magnitudeDelta / MAX_MAGNITUDE_DELTA);
      return { candidate, eligible, score };
    })
    .filter((item) => item.eligible)
    .sort((left, right) => left.score - right.score)[0];

  if (!best) {
    const canonicalId = `CAN:${event.source}:${event.sourceEventId}`;
    await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO canonical_events (
            id, preferred_source_event_pk, association_version,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          canonicalId,
          sourceEventPk,
          ASSOCIATION_VERSION,
          observedAt,
          observedAt,
        ),
      db
        .prepare(
          `INSERT OR IGNORE INTO canonical_event_members (
            canonical_event_id, source_event_pk, association_score,
            association_method, associated_at
          ) VALUES (?, ?, 0, 'source-identity', ?)`,
        )
        .bind(canonicalId, sourceEventPk, observedAt),
    ]);
    return canonicalId;
  }

  const candidate = best.candidate;
  const preferIncoming =
    sourcePriority(event.source) > sourcePriority(candidate.source);
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO canonical_event_members (
          canonical_event_id, source_event_pk, association_score,
          association_method, associated_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        candidate.canonical_event_id,
        sourceEventPk,
        best.score,
        ASSOCIATION_VERSION,
        observedAt,
      ),
    db
      .prepare(
        `UPDATE canonical_events
        SET preferred_source_event_pk = ?, association_version = ?,
          updated_at = ?
        WHERE id = ?`,
      )
      .bind(
        preferIncoming
          ? sourceEventPk
          : candidate.preferred_source_event_pk,
        ASSOCIATION_VERSION,
        observedAt,
        candidate.canonical_event_id,
      ),
  ]);
  return candidate.canonical_event_id;
}

export async function associateSourceEvents(
  db: D1Database,
  events: NormalizedSourceEvent[],
  observedAt: number,
) {
  for (const event of events) {
    await associateEvent(db, event, observedAt);
  }
}
