import type { SeismicSequenceCandidate } from '@/lib/science/seismic-sequences';
import type { CatalogEvent } from '@/shared/schemas';

export type SequenceObservation = {
  event: CatalogEvent;
  timeMs: number;
  cumulativeCount: number;
};

export type SequenceInspectorData =
  | { complete: false; missingEventIds: string[] }
  | {
      complete: true;
      observations: SequenceObservation[];
      magnitudeObservations: SequenceObservation[];
      missingMagnitudeCount: number;
      missingDepthCount: number;
    };

/** Resolve a candidate against the exact verified catalog used to detect it. */
export function buildSequenceInspector(
  candidate: SeismicSequenceCandidate,
  catalog: CatalogEvent[],
): SequenceInspectorData {
  const byId = new Map(catalog.map((event) => [event.id, event]));
  const missingEventIds = candidate.eventIds.filter((id) => !byId.has(id));
  if (missingEventIds.length > 0) {
    return { complete: false, missingEventIds };
  }

  const observations = candidate.eventIds
    .map((id) => byId.get(id)!)
    .sort(
      (left, right) =>
        Date.parse(left.originTime) - Date.parse(right.originTime) ||
        left.id.localeCompare(right.id),
    )
    .map((event, index) => ({
      event,
      timeMs: Date.parse(event.originTime),
      cumulativeCount: index + 1,
    }));

  return {
    complete: true,
    observations,
    magnitudeObservations: observations.filter(
      ({ event }) => event.magnitude !== null,
    ),
    missingMagnitudeCount: observations.filter(
      ({ event }) => event.magnitude === null,
    ).length,
    missingDepthCount: observations.filter(
      ({ event }) => event.depthKm === null,
    ).length,
  };
}

/** Bound chart rendering while preserving both magnitude extremes per interval. */
export function magnitudePlotObservations(
  observations: SequenceObservation[],
  maximumPoints = 600,
) {
  if (observations.length <= maximumPoints) return observations;
  const bucketSize = Math.ceil(
    observations.length / Math.floor(maximumPoints / 2),
  );
  const result: SequenceObservation[] = [];

  for (let start = 0; start < observations.length; start += bucketSize) {
    const bucket = observations.slice(start, start + bucketSize);
    const sorted = [...bucket].sort(
      (left, right) =>
        left.event.magnitude! - right.event.magnitude! ||
        left.timeMs - right.timeMs ||
        left.event.id.localeCompare(right.event.id),
    );
    const extremes = [sorted[0]!, sorted.at(-1)!];
    for (const observation of bucket) {
      if (extremes.includes(observation)) result.push(observation);
    }
  }

  return result;
}

/** Every point remains an exact event count; only intermediate steps are thinned. */
export function cumulativePlotObservations(
  observations: SequenceObservation[],
  maximumPoints = 600,
) {
  if (observations.length <= maximumPoints) return observations;
  const stride = Math.ceil((observations.length - 1) / (maximumPoints - 1));
  const result = observations.filter((_, index) => index % stride === 0);
  const last = observations.at(-1)!;
  if (result.at(-1) !== last) result.push(last);
  return result;
}
