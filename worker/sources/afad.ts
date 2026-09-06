import { z } from 'zod';
import {
  NormalizedSourceEventSchema,
  type NormalizedSourceEvent,
} from '@/shared/schemas';

const AFAD_API_URL =
  'https://deprem.afad.gov.tr/apiv2/event/filter';

const AfadEventSchema = z.object({
  eventID: z.union([z.string(), z.number()]).transform(String),
  date: z.string().min(1),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  depth: z.coerce.number().nullable().optional(),
  magnitude: z.coerce.number().nullable().optional(),
  type: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  isEventUpdate: z.boolean().nullable().optional(),
  lastUpdateDate: z.string().nullable().optional(),
});

export type AfadEvent = z.infer<typeof AfadEventSchema>;

function toAfadTime(date: Date) {
  return date.toISOString().slice(0, 19);
}

function toUtcIso(value: string | null | undefined) {
  if (!value) return null;
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const parsed = new Date(hasOffset ? value : `${value}Z`);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toISOString();
}

export function normalizeAfadEvent(raw: unknown): NormalizedSourceEvent {
  const event = AfadEventSchema.parse(raw);
  const originTime = toUtcIso(event.date);

  if (!originTime) {
    throw new Error(`AFAD event ${event.eventID} has an invalid origin time.`);
  }

  return NormalizedSourceEventSchema.parse({
    source: 'AFAD',
    sourceEventId: event.eventID,
    originTime,
    latitude: event.latitude,
    longitude: event.longitude,
    depthKm: event.depth ?? null,
    magnitude: event.magnitude ?? null,
    magnitudeType: event.type?.trim() || null,
    placeRaw: event.location?.trim() || null,
    sourceStatus: event.isEventUpdate ? 'updated' : 'original',
    sourceUpdatedAt: toUtcIso(event.lastUpdateDate),
  });
}

export async function fetchAfadWindow(
  start: Date,
  end: Date,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(AFAD_API_URL);
  url.searchParams.set('start', toAfadTime(start));
  url.searchParams.set('end', toAfadTime(end));
  url.searchParams.set('minlat', '34');
  url.searchParams.set('maxlat', '43');
  url.searchParams.set('minlon', '23');
  url.searchParams.set('maxlon', '46');
  url.searchParams.set('orderby', 'timedesc');
  url.searchParams.set('limit', '2500');
  url.searchParams.set('format', 'json');

  const response = await fetcher(url, {
    headers: { Accept: 'application/json' },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`AFAD returned HTTP ${response.status}.`);
  }

  const payload = z.array(AfadEventSchema).parse(await response.json());
  return payload.map(normalizeAfadEvent);
}
