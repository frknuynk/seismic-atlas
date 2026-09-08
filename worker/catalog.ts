import type {
  CatalogEvent,
  EventDetail,
  EventQuery,
  EventsResponse,
  SourceHealthResponse,
} from '@/shared/schemas';

type EventRow = {
  id: string;
  source: CatalogEvent['source'];
  source_event_id: string;
  origin_time: number;
  latitude: number;
  longitude: number;
  depth_km: number | null;
  magnitude: number | null;
  magnitude_type: string | null;
  place_raw: string | null;
  revision_count: number;
};

type HealthRow = {
  source: 'AFAD';
  status: 'ok' | 'delayed' | 'error' | 'never_synced';
  last_attempt_at: number | null;
  last_success_at: number | null;
  latest_event_time: number | null;
  consecutive_failures: number;
};

type IngestionRunRow = {
  id: string;
  trigger: 'manual' | 'scheduled';
  window_kind: 'manual' | 'bootstrap' | 'incremental' | 'reconcile';
  window_start: number;
  window_end: number;
  status: 'running' | 'succeeded' | 'failed';
  started_at: number;
  completed_at: number | null;
  attempts: number;
  splits: number;
  write_batches: number;
  fetched: number;
  accepted: number;
  rejected: number;
  duplicates_dropped: number;
  inserted: number;
  updated: number;
  unchanged: number;
  error_code: string | null;
};

type EventDetailRow = EventRow & {
  source_status: string | null;
  source_updated_at: number | null;
  first_seen_at: number;
  last_seen_at: number;
};

type RevisionRow = {
  revision_no: number;
  observed_at: number;
  source_updated_at: number | null;
  origin_time: number;
  latitude: number;
  longitude: number;
  depth_km: number | null;
  magnitude: number | null;
  magnitude_type: string | null;
  place_raw: string | null;
};

function iso(milliseconds: number | null) {
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
}

export async function queryEvents(db: D1Database, query: EventQuery) {
  const clauses = ['e.origin_time >= ?', 'e.origin_time <= ?'];
  const values: Array<string | number> = [
    Date.parse(query.start),
    Date.parse(query.end),
  ];

  const add = (clause: string, value: string | number | undefined) => {
    if (value === undefined) return;
    clauses.push(clause);
    values.push(value);
  };

  add('e.latitude >= ?', query.minLat);
  add('e.latitude <= ?', query.maxLat);
  add('e.longitude >= ?', query.minLon);
  add('e.longitude <= ?', query.maxLon);
  add('e.magnitude >= ?', query.minMag);
  add('e.magnitude <= ?', query.maxMag);
  add('e.depth_km >= ?', query.minDepth);
  add('e.depth_km <= ?', query.maxDepth);
  add('e.source = ?', query.source);

  const statement = db.prepare(
    `SELECT
      e.id,
      e.source,
      e.source_event_id,
      e.origin_time,
      e.latitude,
      e.longitude,
      e.depth_km,
      e.magnitude,
      e.magnitude_type,
      e.place_raw,
      COUNT(r.id) AS revision_count
    FROM source_events e
    LEFT JOIN source_event_revisions r ON r.source_event_pk = e.id
    WHERE ${clauses.join(' AND ')}
    GROUP BY e.id
    ORDER BY e.origin_time DESC
    LIMIT ?`,
  );

  const result = await statement.bind(...values, query.limit).all<EventRow>();
  const events: CatalogEvent[] = result.results.map((row) => ({
    id: row.id,
    source: row.source,
    sourceEventId: row.source_event_id,
    originTime: new Date(row.origin_time).toISOString(),
    latitude: row.latitude,
    longitude: row.longitude,
    depthKm: row.depth_km,
    magnitude: row.magnitude,
    magnitudeType: row.magnitude_type,
    place: row.place_raw,
    revisionCount: Number(row.revision_count),
  }));

  const health = await getSourceHealth(db);
  const response: EventsResponse = {
    meta: {
      count: events.length,
      source: query.source ? [query.source] : ['AFAD'],
      freshness: health.AFAD.lastSuccessAt
        ? { AFAD: health.AFAD.lastSuccessAt }
        : {},
    },
    events,
  };

  return response;
}

export async function getSourceHealth(
  db: D1Database,
): Promise<SourceHealthResponse> {
  const [row, lastRun] = await Promise.all([
    db
      .prepare(
        `SELECT source, status, last_attempt_at, last_success_at,
          latest_event_time, consecutive_failures
        FROM source_health
        WHERE source = ?`,
      )
      .bind('AFAD')
      .first<HealthRow>(),
    db
      .prepare(
        `SELECT id, trigger, window_kind, window_start, window_end, status,
          started_at, completed_at, attempts, splits, write_batches, fetched,
          accepted, rejected, duplicates_dropped, inserted, updated, unchanged,
          error_code
        FROM ingestion_runs
        WHERE source = ?
        ORDER BY started_at DESC
        LIMIT 1`,
      )
      .bind('AFAD')
      .first<IngestionRunRow>(),
  ]);

  if (!row) {
    return {
      AFAD: {
        status: 'never_synced',
        lastAttemptAt: null,
        lastSuccessAt: null,
        latestEventTime: null,
        consecutiveFailures: 0,
        lastRun: null,
      },
    };
  }

  const status =
    row.status === 'ok' &&
    row.last_success_at !== null &&
    Date.now() - row.last_success_at > 5 * 60_000
      ? 'delayed'
      : row.status;

  return {
    AFAD: {
      status,
      lastAttemptAt: iso(row.last_attempt_at),
      lastSuccessAt: iso(row.last_success_at),
      latestEventTime: iso(row.latest_event_time),
      consecutiveFailures: row.consecutive_failures,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            trigger: lastRun.trigger,
            windowKind: lastRun.window_kind,
            windowStart: new Date(lastRun.window_start).toISOString(),
            windowEnd: new Date(lastRun.window_end).toISOString(),
            status: lastRun.status,
            startedAt: new Date(lastRun.started_at).toISOString(),
            completedAt: iso(lastRun.completed_at),
            durationMs:
              lastRun.completed_at === null
                ? null
                : Math.max(0, lastRun.completed_at - lastRun.started_at),
            attempts: lastRun.attempts,
            splits: lastRun.splits,
            writeBatches: lastRun.write_batches,
            fetched: lastRun.fetched,
            accepted: lastRun.accepted,
            rejected: lastRun.rejected,
            duplicatesDropped: lastRun.duplicates_dropped,
            inserted: lastRun.inserted,
            updated: lastRun.updated,
            unchanged: lastRun.unchanged,
            errorCode: lastRun.error_code,
          }
        : null,
    },
  };
}

export async function getEventDetail(
  db: D1Database,
  id: string,
): Promise<EventDetail | null> {
  const event = await db
    .prepare(
      `SELECT
        e.id, e.source, e.source_event_id, e.origin_time, e.latitude,
        e.longitude, e.depth_km, e.magnitude, e.magnitude_type, e.place_raw,
        e.source_status, e.source_updated_at, e.first_seen_at, e.last_seen_at,
        (SELECT COUNT(*) FROM source_event_revisions r
          WHERE r.source_event_pk = e.id) AS revision_count
      FROM source_events e
      WHERE e.id = ?`,
    )
    .bind(id)
    .first<EventDetailRow>();

  if (!event) return null;

  const revisionResult = await db
    .prepare(
      `SELECT revision_no, observed_at, source_updated_at, origin_time,
        latitude, longitude, depth_km, magnitude, magnitude_type, place_raw
      FROM source_event_revisions
      WHERE source_event_pk = ?
      ORDER BY revision_no DESC`,
    )
    .bind(id)
    .all<RevisionRow>();

  return {
    id: event.id,
    source: event.source,
    sourceEventId: event.source_event_id,
    originTime: new Date(event.origin_time).toISOString(),
    latitude: event.latitude,
    longitude: event.longitude,
    depthKm: event.depth_km,
    magnitude: event.magnitude,
    magnitudeType: event.magnitude_type,
    place: event.place_raw,
    revisionCount: Number(event.revision_count),
    sourceStatus: event.source_status,
    sourceUpdatedAt: iso(event.source_updated_at),
    firstSeenAt: new Date(event.first_seen_at).toISOString(),
    lastSeenAt: new Date(event.last_seen_at).toISOString(),
    revisions: revisionResult.results.map((revision) => ({
      revisionNo: revision.revision_no,
      observedAt: new Date(revision.observed_at).toISOString(),
      sourceUpdatedAt: iso(revision.source_updated_at),
      originTime: new Date(revision.origin_time).toISOString(),
      latitude: revision.latitude,
      longitude: revision.longitude,
      depthKm: revision.depth_km,
      magnitude: revision.magnitude,
      magnitudeType: revision.magnitude_type,
      place: revision.place_raw,
    })),
  };
}
