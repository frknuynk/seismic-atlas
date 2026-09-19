import type {
  CatalogEvent,
  EventDetail,
  EventQuery,
  EventsResponse,
  SourceHealthResponse,
} from '@/shared/schemas';
import {
  afadSchedulerHealth,
  afadSourceTiming,
} from '@/shared/source-timing';

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

type CountRow = {
  total: number;
};

type CatalogCursor = {
  originTime: number;
  id: string;
};

export class InvalidCatalogCursorError extends Error {
  constructor() {
    super('The catalog cursor is invalid.');
    this.name = 'InvalidCatalogCursorError';
  }
}

type HealthRow = {
  source: 'AFAD';
  status: 'ok' | 'delayed' | 'error' | 'never_synced';
  last_attempt_at: number | null;
  last_success_at: number | null;
  latest_event_time: number | null;
  consecutive_failures: number;
};

type SourceRequestControlRow = {
  circuit_open_until: number | null;
  last_error_code: string | null;
};

type IngestionRunRow = {
  id: string;
  trigger: 'manual' | 'scheduled';
  window_kind:
    | 'manual'
    | 'bootstrap'
    | 'incremental'
    | 'reconcile'
    | 'backfill';
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

function ingestionRunSummary(run: IngestionRunRow | null) {
  if (!run) return null;
  return {
    id: run.id,
    trigger: run.trigger,
    windowKind: run.window_kind,
    windowStart: new Date(run.window_start).toISOString(),
    windowEnd: new Date(run.window_end).toISOString(),
    status: run.status,
    startedAt: new Date(run.started_at).toISOString(),
    completedAt: iso(run.completed_at),
    durationMs:
      run.completed_at === null
        ? null
        : Math.max(0, run.completed_at - run.started_at),
    attempts: run.attempts,
    splits: run.splits,
    writeBatches: run.write_batches,
    fetched: run.fetched,
    accepted: run.accepted,
    rejected: run.rejected,
    duplicatesDropped: run.duplicates_dropped,
    inserted: run.inserted,
    updated: run.updated,
    unchanged: run.unchanged,
    errorCode: run.error_code,
  };
}

function encodeCatalogCursor(cursor: CatalogCursor) {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function decodeCatalogCursor(value: string): CatalogCursor {
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const parsed = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as Partial<CatalogCursor>;
    if (
      typeof parsed.originTime !== 'number' ||
      !Number.isSafeInteger(parsed.originTime) ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0
    ) {
      throw new InvalidCatalogCursorError();
    }
    return { originTime: parsed.originTime, id: parsed.id };
  } catch (error) {
    if (error instanceof InvalidCatalogCursorError) throw error;
    throw new InvalidCatalogCursorError();
  }
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

  const pageClauses = [...clauses];
  const pageValues = [...values];
  if (query.cursor) {
    const cursor = decodeCatalogCursor(query.cursor);
    pageClauses.push('(e.origin_time < ? OR (e.origin_time = ? AND e.id < ?))');
    pageValues.push(cursor.originTime, cursor.originTime, cursor.id);
  }

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
    WHERE ${pageClauses.join(' AND ')}
    GROUP BY e.id
    ORDER BY e.origin_time DESC, e.id DESC
    LIMIT ?`,
  );

  const [countRow, result, health] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS total
        FROM source_events e
        WHERE ${clauses.join(' AND ')}`,
      )
      .bind(...values)
      .first<CountRow>(),
    statement.bind(...pageValues, query.limit + 1).all<EventRow>(),
    getSourceHealth(db),
  ]);
  const pageRows = result.results.slice(0, query.limit);
  const events: CatalogEvent[] = pageRows.map((row) => ({
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

  const hasMore = result.results.length > query.limit;
  const lastEvent = events.at(-1);
  const nextCursor =
    hasMore && lastEvent
      ? encodeCatalogCursor({
          originTime: Date.parse(lastEvent.originTime),
          id: lastEvent.id,
        })
      : null;
  const total = Number(countRow?.total ?? 0);
  const response: EventsResponse = {
    meta: {
      count: events.length,
      total,
      returned: events.length,
      hasMore,
      truncated: total > events.length,
      nextCursor,
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
  const now = Date.now();
  const [row, lastRun, lastScheduledRun, requestControl] = await Promise.all([
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
    db
      .prepare(
        `SELECT id, trigger, window_kind, window_start, window_end, status,
          started_at, completed_at, attempts, splits, write_batches, fetched,
          accepted, rejected, duplicates_dropped, inserted, updated, unchanged,
          error_code
        FROM ingestion_runs
        WHERE source = ? AND trigger = 'scheduled'
        ORDER BY started_at DESC
        LIMIT 1`,
      )
      .bind('AFAD')
      .first<IngestionRunRow>(),
    db
      .prepare(
        `SELECT circuit_open_until, last_error_code
        FROM source_request_control
        WHERE source = ?`,
      )
      .bind('AFAD')
      .first<SourceRequestControlRow>(),
  ]);

  const requestControlOpen =
    requestControl?.circuit_open_until !== null &&
    requestControl?.circuit_open_until !== undefined &&
    requestControl.circuit_open_until > now;
  const requestControlResponse = {
    status: requestControlOpen ? ('open' as const) : ('closed' as const),
    retryAt: requestControlOpen ? iso(requestControl.circuit_open_until) : null,
    errorCode: requestControlOpen
      ? (requestControl.last_error_code ?? null)
      : null,
  };
  const scheduler = afadSchedulerHealth(
    lastScheduledRun
      ? {
          startedAt: lastScheduledRun.started_at,
          completedAt: lastScheduledRun.completed_at,
          status: lastScheduledRun.status,
        }
      : null,
    now,
  );

  if (!row) {
    const timing = afadSourceTiming(null, now);
    return {
      AFAD: {
        status: 'never_synced',
        lastAttemptAt: null,
        lastSuccessAt: null,
        latestEventTime: null,
        consecutiveFailures: 0,
        ...timing,
        scheduler,
        requestControl: requestControlResponse,
        lastRun: null,
        lastScheduledRun: ingestionRunSummary(lastScheduledRun),
      },
    };
  }

  const timing = afadSourceTiming(row.last_success_at, now);
  const status =
    row.status === 'ok' &&
    timing.freshness.state !== 'fresh'
      ? 'delayed'
      : row.status;

  return {
    AFAD: {
      status,
      lastAttemptAt: iso(row.last_attempt_at),
      lastSuccessAt: iso(row.last_success_at),
      latestEventTime: iso(row.latest_event_time),
      consecutiveFailures: row.consecutive_failures,
      ...timing,
      scheduler,
      requestControl: requestControlResponse,
      lastRun: ingestionRunSummary(lastRun),
      lastScheduledRun: ingestionRunSummary(lastScheduledRun),
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
