import type { NormalizedSourceEvent } from '@/shared/schemas';

const SOURCE = 'AFAD';
const MAX_EVENTS_PER_BATCH = 1_000;

type ExistingEventRow = {
  id: string;
  source_event_id: string;
  payload_hash: string;
};

type PersistenceKind = 'inserted' | 'updated' | 'unchanged';

type PersistenceRow = {
  id: string;
  sourceEventId: string;
  originTime: number;
  latitude: number;
  longitude: number;
  depthKm: number | null;
  magnitude: number | null;
  magnitudeType: string | null;
  placeRaw: string | null;
  sourceStatus: string | null;
  sourceUpdatedAt: number | null;
  observedAt: number;
  payloadHash: string;
  rawJson: string;
  persistence: PersistenceKind;
};

export type PersistenceCounts = {
  inserted: number;
  updated: number;
  unchanged: number;
  batches: number;
};

export type PersistenceOptions = {
  beforeBatch?: () => Promise<void>;
  maxEventsPerBatch?: number;
  onBatchCommitted?: (committedBatches: number) => void;
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

async function loadExistingEvents(
  db: D1Database,
  events: NormalizedSourceEvent[],
) {
  const sourceEventIds = events.map((event) => event.sourceEventId);
  const result = await db
    .prepare(
      `SELECT id, source_event_id, payload_hash
      FROM source_events
      WHERE source = ?
        AND source_event_id IN (
          SELECT CAST(value AS TEXT) FROM json_each(?)
        )`,
    )
    .bind(SOURCE, JSON.stringify(sourceEventIds))
    .all<ExistingEventRow>();

  return new Map(
    result.results.map((row) => [row.source_event_id, row] as const),
  );
}

async function prepareRows(
  events: NormalizedSourceEvent[],
  existingEvents: Map<string, ExistingEventRow>,
  observedAt: number,
) {
  return Promise.all(
    events.map(async (event): Promise<PersistenceRow> => {
      const existing = existingEvents.get(event.sourceEventId);
      const hash = await payloadHash(event);
      const persistence: PersistenceKind = !existing
        ? 'inserted'
        : existing.payload_hash === hash
          ? 'unchanged'
          : 'updated';

      return {
        id: existing?.id ?? `${SOURCE}:${event.sourceEventId}`,
        sourceEventId: event.sourceEventId,
        originTime: Date.parse(event.originTime),
        latitude: event.latitude,
        longitude: event.longitude,
        depthKm: event.depthKm,
        magnitude: event.magnitude,
        magnitudeType: event.magnitudeType,
        placeRaw: event.placeRaw,
        sourceStatus: event.sourceStatus,
        sourceUpdatedAt: event.sourceUpdatedAt
          ? Date.parse(event.sourceUpdatedAt)
          : null,
        observedAt,
        payloadHash: hash,
        rawJson: JSON.stringify(event),
        persistence,
      };
    }),
  );
}

function databaseRows(rows: PersistenceRow[]) {
  return rows.map(({ persistence: _, ...row }) => row);
}

function upsertEventsStatement(db: D1Database, rows: PersistenceRow[]) {
  return db
    .prepare(
      `INSERT INTO source_events (
        id, source, source_event_id, origin_time, latitude, longitude,
        depth_km, magnitude, magnitude_type, place_raw, source_status,
        source_updated_at, first_seen_at, last_seen_at, payload_hash
      )
      SELECT
        json_extract(incoming.value, '$.id'),
        ?,
        json_extract(incoming.value, '$.sourceEventId'),
        CAST(json_extract(incoming.value, '$.originTime') AS INTEGER),
        json_extract(incoming.value, '$.latitude'),
        json_extract(incoming.value, '$.longitude'),
        json_extract(incoming.value, '$.depthKm'),
        json_extract(incoming.value, '$.magnitude'),
        json_extract(incoming.value, '$.magnitudeType'),
        json_extract(incoming.value, '$.placeRaw'),
        json_extract(incoming.value, '$.sourceStatus'),
        CAST(json_extract(incoming.value, '$.sourceUpdatedAt') AS INTEGER),
        CAST(json_extract(incoming.value, '$.observedAt') AS INTEGER),
        CAST(json_extract(incoming.value, '$.observedAt') AS INTEGER),
        json_extract(incoming.value, '$.payloadHash')
      FROM json_each(?) AS incoming
      WHERE TRUE
      ON CONFLICT(source, source_event_id) DO UPDATE SET
        origin_time = excluded.origin_time,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        depth_km = excluded.depth_km,
        magnitude = excluded.magnitude,
        magnitude_type = excluded.magnitude_type,
        place_raw = excluded.place_raw,
        source_status = excluded.source_status,
        source_updated_at = excluded.source_updated_at,
        last_seen_at = excluded.last_seen_at,
        payload_hash = excluded.payload_hash`,
    )
    .bind(SOURCE, JSON.stringify(databaseRows(rows)));
}

function insertRevisionsStatement(db: D1Database, rows: PersistenceRow[]) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO source_event_revisions (
        source_event_pk, revision_no, payload_hash, observed_at,
        source_updated_at, origin_time, latitude, longitude, depth_km,
        magnitude, magnitude_type, place_raw, raw_json
      )
      SELECT
        event.id,
        COALESCE((
          SELECT MAX(revision.revision_no) + 1
          FROM source_event_revisions AS revision
          WHERE revision.source_event_pk = event.id
        ), 1),
        json_extract(incoming.value, '$.payloadHash'),
        CAST(json_extract(incoming.value, '$.observedAt') AS INTEGER),
        CAST(json_extract(incoming.value, '$.sourceUpdatedAt') AS INTEGER),
        CAST(json_extract(incoming.value, '$.originTime') AS INTEGER),
        json_extract(incoming.value, '$.latitude'),
        json_extract(incoming.value, '$.longitude'),
        json_extract(incoming.value, '$.depthKm'),
        json_extract(incoming.value, '$.magnitude'),
        json_extract(incoming.value, '$.magnitudeType'),
        json_extract(incoming.value, '$.placeRaw'),
        json_extract(incoming.value, '$.rawJson')
      FROM json_each(?) AS incoming
      INNER JOIN source_events AS event
        ON event.source = ?
        AND event.source_event_id = json_extract(
          incoming.value,
          '$.sourceEventId'
        )`,
    )
    .bind(JSON.stringify(databaseRows(rows)), SOURCE);
}

export async function persistEventsInBatches(
  db: D1Database,
  events: NormalizedSourceEvent[],
  observedAt: number,
  options: PersistenceOptions = {},
): Promise<PersistenceCounts> {
  if (events.length === 0) {
    return { inserted: 0, updated: 0, unchanged: 0, batches: 0 };
  }

  const existingEvents = await loadExistingEvents(db, events);
  const rows = await prepareRows(events, existingEvents, observedAt);
  const counts = rows.reduce<PersistenceCounts>(
    (totals, row) => {
      totals[row.persistence] += 1;
      return totals;
    },
    { inserted: 0, updated: 0, unchanged: 0, batches: 0 },
  );
  const batchSize = Math.min(
    MAX_EVENTS_PER_BATCH,
    Math.max(1, options.maxEventsPerBatch ?? MAX_EVENTS_PER_BATCH),
  );

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await options.beforeBatch?.();
    const batchRows = rows.slice(offset, offset + batchSize);
    const revisionRows = batchRows.filter(
      (row) => row.persistence !== 'unchanged',
    );
    const statements = [upsertEventsStatement(db, batchRows)];
    if (revisionRows.length > 0) {
      statements.push(insertRevisionsStatement(db, revisionRows));
    }
    await db.batch(statements);
    counts.batches += 1;
    options.onBatchCommitted?.(counts.batches);
  }

  return counts;
}
