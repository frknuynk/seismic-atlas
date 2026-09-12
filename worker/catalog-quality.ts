import type { CatalogQualityResponse } from '@/shared/schemas';

type QualityAggregateRow = {
  total: number;
  first_event_time: number | null;
  last_event_time: number | null;
  missing_magnitude: number;
  missing_depth: number;
  missing_magnitude_type: number;
  missing_place: number;
  invalid_coordinates: number;
  negative_depth: number;
  extreme_depth: number;
  unusual_magnitude: number;
};

type CountRow = { count: number };

type IngestionAggregateRow = {
  runs: number;
  fetched: number | null;
  accepted: number | null;
  rejected: number | null;
  duplicates_dropped: number | null;
};

function percent(present: number, total: number) {
  if (total === 0) return 0;
  return Math.round((present / total) * 10_000) / 100;
}

function iso(milliseconds: number | null) {
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
}

export async function getCatalogQuality(
  db: D1Database,
  now = Date.now(),
): Promise<CatalogQualityResponse> {
  const [aggregate, duplicates, revised, ingestion] = await Promise.all([
    db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          MIN(origin_time) AS first_event_time,
          MAX(origin_time) AS last_event_time,
          SUM(CASE WHEN magnitude IS NULL THEN 1 ELSE 0 END) AS missing_magnitude,
          SUM(CASE WHEN depth_km IS NULL THEN 1 ELSE 0 END) AS missing_depth,
          SUM(CASE WHEN magnitude_type IS NULL OR TRIM(magnitude_type) = '' THEN 1 ELSE 0 END) AS missing_magnitude_type,
          SUM(CASE WHEN place_raw IS NULL OR TRIM(place_raw) = '' THEN 1 ELSE 0 END) AS missing_place,
          SUM(CASE WHEN latitude < -90 OR latitude > 90 OR longitude < -180 OR longitude > 180 THEN 1 ELSE 0 END) AS invalid_coordinates,
          SUM(CASE WHEN depth_km < 0 THEN 1 ELSE 0 END) AS negative_depth,
          SUM(CASE WHEN depth_km > 700 THEN 1 ELSE 0 END) AS extreme_depth,
          SUM(CASE WHEN magnitude < -2 OR magnitude > 10 THEN 1 ELSE 0 END) AS unusual_magnitude
        FROM source_events
        WHERE source = ?`,
      )
      .bind('AFAD')
      .first<QualityAggregateRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
          SELECT source_event_id
          FROM source_events
          WHERE source = ?
          GROUP BY source_event_id
          HAVING COUNT(*) > 1
        )`,
      )
      .bind('AFAD')
      .first<CountRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
          SELECT revision.source_event_pk
          FROM source_event_revisions revision
          INNER JOIN source_events event ON event.id = revision.source_event_pk
          WHERE event.source = ?
          GROUP BY revision.source_event_pk
          HAVING COUNT(*) > 1
        )`,
      )
      .bind('AFAD')
      .first<CountRow>(),
    db
      .prepare(
        `SELECT
          COUNT(*) AS runs,
          SUM(fetched) AS fetched,
          SUM(accepted) AS accepted,
          SUM(rejected) AS rejected,
          SUM(duplicates_dropped) AS duplicates_dropped
        FROM ingestion_runs
        WHERE source = ? AND started_at >= ?`,
      )
      .bind('AFAD', now - 7 * 24 * 60 * 60_000)
      .first<IngestionAggregateRow>(),
  ]);

  const counts = {
    total: Number(aggregate?.total ?? 0),
    revisedEvents: Number(revised?.count ?? 0),
    missingMagnitude: Number(aggregate?.missing_magnitude ?? 0),
    missingDepth: Number(aggregate?.missing_depth ?? 0),
    missingMagnitudeType: Number(aggregate?.missing_magnitude_type ?? 0),
    missingPlace: Number(aggregate?.missing_place ?? 0),
    invalidCoordinates: Number(aggregate?.invalid_coordinates ?? 0),
    negativeDepth: Number(aggregate?.negative_depth ?? 0),
    extremeDepth: Number(aggregate?.extreme_depth ?? 0),
    unusualMagnitude: Number(aggregate?.unusual_magnitude ?? 0),
    duplicateSourceIds: Number(duplicates?.count ?? 0),
  };
  const hardFailures =
    counts.invalidCoordinates +
    counts.negativeDepth +
    counts.duplicateSourceIds;
  const coverageWarnings =
    counts.missingMagnitude +
    counts.missingDepth +
    counts.missingMagnitudeType +
    counts.missingPlace;
  const softWarnings =
    coverageWarnings + counts.extremeDepth + counts.unusualMagnitude;
  const ingestionLast7Days = {
    runs: Number(ingestion?.runs ?? 0),
    fetched: Number(ingestion?.fetched ?? 0),
    accepted: Number(ingestion?.accepted ?? 0),
    rejected: Number(ingestion?.rejected ?? 0),
    duplicatesDropped: Number(ingestion?.duplicates_dropped ?? 0),
  };
  const status: CatalogQualityResponse['status'] =
    hardFailures > 0
      ? 'critical'
      : counts.total === 0 ||
          softWarnings > 0 ||
          ingestionLast7Days.rejected > 0
        ? 'warning'
        : 'healthy';

  return {
    generatedAt: new Date().toISOString(),
    source: 'AFAD',
    status,
    coverage: {
      firstEventTime: iso(aggregate?.first_event_time ?? null),
      lastEventTime: iso(aggregate?.last_event_time ?? null),
    },
    counts,
    coveragePercent: {
      magnitude: percent(counts.total - counts.missingMagnitude, counts.total),
      depth: percent(counts.total - counts.missingDepth, counts.total),
      magnitudeType: percent(
        counts.total - counts.missingMagnitudeType,
        counts.total,
      ),
      place: percent(counts.total - counts.missingPlace, counts.total),
    },
    ingestionLast7Days,
    checks: [
      {
        code: 'source-identity-unique',
        status: counts.duplicateSourceIds === 0 ? 'pass' : 'fail',
        affected: counts.duplicateSourceIds,
        message: 'Source event identifiers must be unique.',
      },
      {
        code: 'coordinates-valid',
        status: counts.invalidCoordinates === 0 ? 'pass' : 'fail',
        affected: counts.invalidCoordinates,
        message: 'Coordinates must remain inside geographic bounds.',
      },
      {
        code: 'depth-nonnegative',
        status: counts.negativeDepth === 0 ? 'pass' : 'fail',
        affected: counts.negativeDepth,
        message: 'Reported depth cannot be negative.',
      },
      {
        code: 'reported-fields',
        status: coverageWarnings === 0 ? 'pass' : 'warning',
        affected: coverageWarnings,
        message: 'Magnitude, depth, type, and place coverage are monitored.',
      },
      {
        code: 'scientific-outliers',
        status:
          counts.extremeDepth + counts.unusualMagnitude === 0
            ? 'pass'
            : 'warning',
        affected: counts.extremeDepth + counts.unusualMagnitude,
        message: 'Extreme depth and magnitude values require review.',
      },
      {
        code: 'ingestion-rejections-7d',
        status: ingestionLast7Days.rejected === 0 ? 'pass' : 'warning',
        affected: ingestionLast7Days.rejected,
        message: 'Rejected upstream records remain quarantined for review.',
      },
    ],
  };
}
