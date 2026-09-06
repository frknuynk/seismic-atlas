export type FaultProperties = {
  id: string;
  name: string | null;
  slip_type: string | null;
  catalog_name: string | null;
  catalog_id: string | null;
  average_dip: string | null;
  dip_dir: string | null;
  net_slip_rate: string | null;
};

type Position = [number, number];

export type FaultFeature = {
  type: 'Feature';
  properties: FaultProperties;
  geometry:
    | { type: 'LineString'; coordinates: Position[] }
    | { type: 'MultiLineString'; coordinates: Position[][] };
};

export type FaultFeatureCollection = {
  type: 'FeatureCollection';
  features: FaultFeature[];
};

export type NearbyFault = FaultProperties & {
  distanceKm: number;
  label: string;
};

const KM_PER_DEGREE_LATITUDE = 110.574;
const KM_PER_DEGREE_LONGITUDE = 111.32;

function pointToSegmentDistanceKm(
  point: Position,
  start: Position,
  end: Position,
) {
  const longitudeScale =
    KM_PER_DEGREE_LONGITUDE * Math.cos((point[1] * Math.PI) / 180);
  const startX = (start[0] - point[0]) * longitudeScale;
  const startY = (start[1] - point[1]) * KM_PER_DEGREE_LATITUDE;
  const endX = (end[0] - point[0]) * longitudeScale;
  const endY = (end[1] - point[1]) * KM_PER_DEGREE_LATITUDE;
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
  const projection =
    segmentLengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            -(startX * segmentX + startY * segmentY) / segmentLengthSquared,
          ),
        );
  return Math.hypot(
    startX + projection * segmentX,
    startY + projection * segmentY,
  );
}

function featureDistanceKm(feature: FaultFeature, point: Position) {
  const lines =
    feature.geometry.type === 'LineString'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  let closest = Number.POSITIVE_INFINITY;

  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      closest = Math.min(
        closest,
        pointToSegmentDistanceKm(point, line[index - 1], line[index]),
      );
    }
  }
  return closest;
}

export function findNearestFault(
  collection: FaultFeatureCollection,
  longitude: number,
  latitude: number,
): NearbyFault | null {
  let nearest: NearbyFault | null = null;

  for (const feature of collection.features) {
    const distanceKm = featureDistanceKm(feature, [longitude, latitude]);
    if (!Number.isFinite(distanceKm)) continue;
    if (nearest && distanceKm >= nearest.distanceKm) continue;

    const properties = feature.properties;
    nearest = {
      ...properties,
      distanceKm,
      label:
        properties.name ?? `${properties.slip_type ?? 'Mapped'} fault segment`,
    };
  }

  return nearest;
}
