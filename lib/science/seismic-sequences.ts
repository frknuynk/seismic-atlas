import type { CatalogEvent } from '@/shared/schemas';

export const SEISMIC_SEQUENCE_VERSION = 'sequence-candidates-v1';

export const DEFAULT_SEQUENCE_PARAMETERS = {
  maxNeighborDistanceKm: 30,
  maxNeighborTimeHours: 24,
  minEvents: 3,
} as const;

export type SequenceParameters = {
  maxNeighborDistanceKm: number;
  maxNeighborTimeHours: number;
  minEvents: number;
};

export type SeismicSequenceCandidate = {
  id: string;
  eventIds: string[];
  eventCount: number;
  startTime: string;
  endTime: string;
  durationHours: number;
  centroid: { latitude: number; longitude: number };
  spatialRadiusKm: number;
  maximumMagnitude: number | null;
  largestEventId: string;
  representativePlace: string | null;
};

export type SequenceAnalysis = {
  version: typeof SEISMIC_SEQUENCE_VERSION;
  method: 'spatiotemporal-single-linkage';
  parameters: SequenceParameters;
  candidateCount: number;
  clusteredEventCount: number;
  unclusteredEventCount: number;
  candidates: SeismicSequenceCandidate[];
};

type IndexedEvent = {
  event: CatalogEvent;
  originalIndex: number;
  timeMs: number;
};

const EARTH_RADIUS_KM = 6_371.0088;
const KM_PER_LATITUDE_DEGREE = 111.32;

function radians(value: number) {
  return (value * Math.PI) / 180;
}

export function epicentralDistanceKm(
  left: Pick<CatalogEvent, 'latitude' | 'longitude'>,
  right: Pick<CatalogEvent, 'latitude' | 'longitude'>,
) {
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const leftLatitude = radians(left.latitude);
  const rightLatitude = radians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    2 *
    EARTH_RADIUS_KM *
    Math.asin(Math.min(1, Math.sqrt(Math.max(0, haversine))))
  );
}

function rounded(value: number, precision = 3) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function stableHash(values: string[]) {
  let hash = 2_166_136_261;
  for (const value of values) {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    hash ^= 31;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

class DisjointSet {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(index: number): number {
    const parent = this.parent[index]!;
    if (parent === index) return index;
    const root = this.find(parent);
    this.parent[index] = root;
    return root;
  }

  union(left: number, right: number) {
    let leftRoot = this.find(left);
    let rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;

    if (this.rank[leftRoot]! < this.rank[rightRoot]!) {
      [leftRoot, rightRoot] = [rightRoot, leftRoot];
    }
    this.parent[rightRoot] = leftRoot;
    if (this.rank[leftRoot] === this.rank[rightRoot]) {
      this.rank[leftRoot]! += 1;
    }
  }
}

function validateParameters(parameters: SequenceParameters) {
  if (
    !Number.isFinite(parameters.maxNeighborDistanceKm) ||
    parameters.maxNeighborDistanceKm <= 0 ||
    !Number.isFinite(parameters.maxNeighborTimeHours) ||
    parameters.maxNeighborTimeHours <= 0 ||
    !Number.isInteger(parameters.minEvents) ||
    parameters.minEvents < 2
  ) {
    throw new RangeError('Sequence parameters must be finite and positive.');
  }
}

function largestEvent(events: IndexedEvent[]) {
  return [...events].sort((left, right) => {
    const magnitudeDifference =
      (right.event.magnitude ?? Number.NEGATIVE_INFINITY) -
      (left.event.magnitude ?? Number.NEGATIVE_INFINITY);
    return (
      magnitudeDifference ||
      left.timeMs - right.timeMs ||
      left.event.id.localeCompare(right.event.id)
    );
  })[0]!;
}

function candidateFrom(events: IndexedEvent[]): SeismicSequenceCandidate {
  const chronological = [...events].sort(
    (left, right) =>
      left.timeMs - right.timeMs || left.event.id.localeCompare(right.event.id),
  );
  const eventIds = chronological.map(({ event }) => event.id);
  const latitude =
    chronological.reduce((sum, item) => sum + item.event.latitude, 0) /
    chronological.length;
  const longitude =
    chronological.reduce((sum, item) => sum + item.event.longitude, 0) /
    chronological.length;
  const centroid = { latitude, longitude };
  const representative = largestEvent(chronological);
  const maximumMagnitude = representative.event.magnitude;
  const startMs = chronological[0]!.timeMs;
  const endMs = chronological.at(-1)!.timeMs;

  return {
    id: `sequence-${stableHash([...eventIds].sort())}`,
    eventIds,
    eventCount: chronological.length,
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    durationHours: rounded((endMs - startMs) / 3_600_000, 2),
    centroid: {
      latitude: rounded(latitude, 5),
      longitude: rounded(longitude, 5),
    },
    spatialRadiusKm: rounded(
      Math.max(
        ...chronological.map(({ event }) =>
          epicentralDistanceKm(event, centroid),
        ),
      ),
      2,
    ),
    maximumMagnitude,
    largestEventId: representative.event.id,
    representativePlace: representative.event.place,
  };
}

export function detectSequenceCandidates(
  events: CatalogEvent[],
  parameters: SequenceParameters = DEFAULT_SEQUENCE_PARAMETERS,
): SequenceAnalysis {
  validateParameters(parameters);
  const indexed = events
    .map((event, originalIndex) => ({
      event,
      originalIndex,
      timeMs: Date.parse(event.originTime),
    }))
    .filter((item) => Number.isFinite(item.timeMs))
    .sort(
      (left, right) =>
        left.timeMs - right.timeMs ||
        left.event.id.localeCompare(right.event.id),
    );
  const disjointSet = new DisjointSet(events.length);
  const maximumTimeMs = parameters.maxNeighborTimeHours * 3_600_000;
  const cellDiagonalScale = Math.SQRT2;
  const latitudeCellSize =
    parameters.maxNeighborDistanceKm /
    (KM_PER_LATITUDE_DEGREE * cellDiagonalScale);
  const minimumAbsoluteLatitude = Math.min(
    90,
    ...indexed.map(({ event }) => Math.abs(event.latitude)),
  );
  const maximumCosine = Math.max(
    0.1,
    Math.cos(radians(Math.min(89.9, minimumAbsoluteLatitude))),
  );
  const longitudeCellSize =
    parameters.maxNeighborDistanceKm /
    (KM_PER_LATITUDE_DEGREE * maximumCosine * cellDiagonalScale);
  const spatialBuckets = new Map<string, IndexedEvent[]>();

  const cellFor = (event: CatalogEvent) => ({
    latitude: Math.floor((event.latitude + 90) / latitudeCellSize),
    longitude: Math.floor((event.longitude + 180) / longitudeCellSize),
  });

  for (const current of indexed) {
    const cell = cellFor(current.event);
    const key = `${cell.latitude}:${cell.longitude}`;
    const sameCell = spatialBuckets.get(key);
    const newestSameCell = sameCell?.at(-1);
    if (
      newestSameCell &&
      current.timeMs - newestSameCell.timeMs <= maximumTimeMs
    ) {
      // The cell diagonal is bounded by the distance threshold, so its newest
      // in-window event is a sufficient exact connection for this cell.
      disjointSet.union(current.originalIndex, newestSameCell.originalIndex);
    }

    for (let latitudeOffset = -2; latitudeOffset <= 2; latitudeOffset += 1) {
      for (
        let longitudeOffset = -2;
        longitudeOffset <= 2;
        longitudeOffset += 1
      ) {
        if (latitudeOffset === 0 && longitudeOffset === 0) continue;
        const candidates = spatialBuckets.get(
          `${cell.latitude + latitudeOffset}:${cell.longitude + longitudeOffset}`,
        );
        if (!candidates) continue;

        for (let index = candidates.length - 1; index >= 0; index -= 1) {
          const previous = candidates[index]!;
          if (current.timeMs - previous.timeMs > maximumTimeMs) break;
          if (
            disjointSet.find(current.originalIndex) ===
            disjointSet.find(previous.originalIndex)
          ) {
            continue;
          }
          if (
            epicentralDistanceKm(current.event, previous.event) <=
            parameters.maxNeighborDistanceKm
          ) {
            disjointSet.union(current.originalIndex, previous.originalIndex);
          }
        }
      }
    }

    const bucket = spatialBuckets.get(key);
    if (bucket) bucket.push(current);
    else spatialBuckets.set(key, [current]);
  }

  const components = new Map<number, IndexedEvent[]>();
  for (const item of indexed) {
    const root = disjointSet.find(item.originalIndex);
    const component = components.get(root);
    if (component) component.push(item);
    else components.set(root, [item]);
  }

  const candidates = [...components.values()]
    .filter((component) => component.length >= parameters.minEvents)
    .map(candidateFrom)
    .sort(
      (left, right) =>
        right.eventCount - left.eventCount ||
        (right.maximumMagnitude ?? Number.NEGATIVE_INFINITY) -
          (left.maximumMagnitude ?? Number.NEGATIVE_INFINITY) ||
        Date.parse(right.endTime) - Date.parse(left.endTime) ||
        left.id.localeCompare(right.id),
    );
  const clusteredEventCount = candidates.reduce(
    (sum, candidate) => sum + candidate.eventCount,
    0,
  );

  return {
    version: SEISMIC_SEQUENCE_VERSION,
    method: 'spatiotemporal-single-linkage',
    parameters: { ...parameters },
    candidateCount: candidates.length,
    clusteredEventCount,
    unclusteredEventCount: events.length - clusteredEventCount,
    candidates,
  };
}
