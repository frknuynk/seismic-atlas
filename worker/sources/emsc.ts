import { z } from 'zod';
import {
  NormalizedSourceEventSchema,
  type NormalizedSourceEvent,
} from '@/shared/schemas';
import {
  FdsnSourceError,
  fetchFdsnWindowWithDiagnostics,
  type FdsnFetchOptions,
  type SourceWindowResult,
} from '@/worker/sources/fdsn';

const EMSC_API_URL = 'https://www.seismicportal.eu/fdsnws/event/1/query';
const EMSC_RESPONSE_LIMIT = 20_000;
const EMSC_CLIENT_IDENTITY =
  'SeismicAtlas/0.9 (+https://github.com/frknuynk/seismic-atlas)';

const EmscFeatureSchema = z.object({
  id: z.string().min(1),
  properties: z.object({
    unid: z.string().min(1).optional(),
    time: z.iso.datetime({ offset: true }),
    lat: z.coerce.number(),
    lon: z.coerce.number(),
    depth: z.coerce.number().nullable().optional(),
    mag: z.coerce.number().nullable().optional(),
    magtype: z.string().nullable().optional(),
    flynn_region: z.string().nullable().optional(),
    evtype: z.string().nullable().optional(),
    lastupdate: z.iso.datetime({ offset: true }).nullable().optional(),
  }),
});

const EmscPayloadSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.unknown()),
});

export type EmscWindowResult = SourceWindowResult;
export type EmscFetchOptions = FdsnFetchOptions;
export { FdsnSourceError as EmscSourceError };

function emscWindowUrl(start: Date, end: Date, limit: number) {
  const url = new URL(EMSC_API_URL);
  url.searchParams.set('format', 'json');
  url.searchParams.set('starttime', start.toISOString());
  url.searchParams.set('endtime', end.toISOString());
  url.searchParams.set('minlatitude', '34');
  url.searchParams.set('maxlatitude', '43');
  url.searchParams.set('minlongitude', '23');
  url.searchParams.set('maxlongitude', '46');
  url.searchParams.set('orderby', 'time-asc');
  url.searchParams.set('limit', String(limit));
  return url;
}

export function normalizeEmscEvent(raw: unknown): NormalizedSourceEvent {
  const feature = EmscFeatureSchema.parse(raw);
  const event = feature.properties;
  return NormalizedSourceEventSchema.parse({
    source: 'EMSC',
    sourceEventId: event.unid ?? feature.id,
    originTime: new Date(event.time).toISOString(),
    latitude: event.lat,
    longitude: event.lon,
    depthKm: event.depth ?? null,
    magnitude: event.mag ?? null,
    magnitudeType: event.magtype?.trim() || null,
    placeRaw: event.flynn_region?.trim() || null,
    sourceStatus: event.evtype?.trim() || null,
    sourceUpdatedAt: event.lastupdate
      ? new Date(event.lastupdate).toISOString()
      : null,
  });
}

const config = {
  source: 'EMSC' as const,
  clientIdentity: EMSC_CLIENT_IDENTITY,
  responseLimit: EMSC_RESPONSE_LIMIT,
  buildUrl: emscWindowUrl,
  records(payload: unknown) {
    return EmscPayloadSchema.parse(payload).features;
  },
  normalize: normalizeEmscEvent,
  sourceEventId(raw: unknown) {
    if (typeof raw !== 'object' || raw === null) return null;
    if ('id' in raw) return String(raw.id);
    return null;
  },
};

export function fetchEmscWindowWithDiagnostics(
  start: Date,
  end: Date,
  fetcher: typeof fetch = fetch,
  options: EmscFetchOptions = {},
) {
  return fetchFdsnWindowWithDiagnostics(config, start, end, fetcher, options);
}
