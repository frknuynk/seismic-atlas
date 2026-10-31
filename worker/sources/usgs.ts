import { z } from 'zod';
import {
  NormalizedSourceEventSchema,
  type NormalizedSourceEvent,
} from '@/shared/schemas';
import {
  FdsnSourceError,
  fetchFdsnWindowWithDiagnostics,
  type FdsnFetchOptions,
  type SourceFetchProgress,
  type SourceRejectedRecord,
  type SourceWindowResult,
} from '@/worker/sources/fdsn';

const USGS_API_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const USGS_RESPONSE_LIMIT = 20_000;
const USGS_CLIENT_IDENTITY =
  'SeismicAtlas/0.9 (+https://github.com/frknuynk/seismic-atlas)';

const UsgsFeatureSchema = z.object({
  id: z.string().min(1),
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([
      z.coerce.number(),
      z.coerce.number(),
      z.coerce.number().nullable().optional(),
    ]),
  }),
  properties: z.object({
    time: z.coerce.number(),
    updated: z.coerce.number().nullable().optional(),
    mag: z.coerce.number().nullable().optional(),
    magType: z.string().nullable().optional(),
    place: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
  }),
});

const UsgsPayloadSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.unknown()),
});

export type UsgsWindowResult = SourceWindowResult;
export type UsgsRejectedRecord = SourceRejectedRecord;
export type UsgsFetchProgress = SourceFetchProgress;
export type UsgsFetchOptions = FdsnFetchOptions;
export { FdsnSourceError as UsgsSourceError };

function usgsWindowUrl(start: Date, end: Date, limit: number) {
  const url = new URL(USGS_API_URL);
  url.searchParams.set('format', 'geojson');
  url.searchParams.set('starttime', start.toISOString());
  url.searchParams.set('endtime', end.toISOString());
  url.searchParams.set('minlatitude', '34');
  url.searchParams.set('maxlatitude', '43');
  url.searchParams.set('minlongitude', '23');
  url.searchParams.set('maxlongitude', '46');
  url.searchParams.set('eventtype', 'earthquake');
  url.searchParams.set('orderby', 'time-asc');
  url.searchParams.set('limit', String(limit));
  return url;
}

export function normalizeUsgsEvent(raw: unknown): NormalizedSourceEvent {
  const feature = UsgsFeatureSchema.parse(raw);
  const [longitude, latitude, depth] = feature.geometry.coordinates;
  const originTime = new Date(feature.properties.time);
  const sourceUpdatedAt = feature.properties.updated
    ? new Date(feature.properties.updated)
    : null;

  return NormalizedSourceEventSchema.parse({
    source: 'USGS',
    sourceEventId: feature.id,
    originTime: originTime.toISOString(),
    latitude,
    longitude,
    depthKm: depth ?? null,
    magnitude: feature.properties.mag ?? null,
    magnitudeType: feature.properties.magType?.trim() || null,
    placeRaw: feature.properties.place?.trim() || null,
    sourceStatus: feature.properties.status?.trim() || null,
    sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
  });
}

const config = {
  source: 'USGS' as const,
  clientIdentity: USGS_CLIENT_IDENTITY,
  responseLimit: USGS_RESPONSE_LIMIT,
  buildUrl: usgsWindowUrl,
  records(payload: unknown) {
    return UsgsPayloadSchema.parse(payload).features;
  },
  normalize: normalizeUsgsEvent,
  sourceEventId(raw: unknown) {
    return typeof raw === 'object' && raw !== null && 'id' in raw
      ? String(raw.id)
      : null;
  },
};

export function fetchUsgsWindowWithDiagnostics(
  start: Date,
  end: Date,
  fetcher: typeof fetch = fetch,
  options: UsgsFetchOptions = {},
) {
  return fetchFdsnWindowWithDiagnostics(config, start, end, fetcher, options);
}
