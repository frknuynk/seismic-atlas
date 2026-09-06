import { z } from 'zod';
import {
  NormalizedSourceEventSchema,
  type NormalizedSourceEvent,
} from '@/shared/schemas';

const AFAD_API_URL = 'https://deprem.afad.gov.tr/apiv2/event/filter';

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

export type AfadWindowResult = {
  events: NormalizedSourceEvent[];
  rejections: AfadRejectedRecord[];
  attempts: number;
  received: number;
  rejected: number;
  duplicatesDropped: number;
};

export type AfadRejectedRecord = {
  sourceEventId: string | null;
  reason: string;
  rawJson: string;
};

type AfadFetchOptions = {
  maxAttempts?: number;
  timeoutMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

export class AfadSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly attempts: number,
    readonly rejections: AfadRejectedRecord[] = [],
  ) {
    super(message);
    this.name = 'AfadSourceError';
  }
}

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

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function sourceUpdateTime(event: NormalizedSourceEvent) {
  return event.sourceUpdatedAt ? Date.parse(event.sourceUpdatedAt) : 0;
}

function rejectedRecord(rawEvent: unknown, error: unknown): AfadRejectedRecord {
  const sourceEventId =
    typeof rawEvent === 'object' &&
    rawEvent !== null &&
    'eventID' in rawEvent &&
    (typeof rawEvent.eventID === 'string' ||
      typeof rawEvent.eventID === 'number')
      ? String(rawEvent.eventID)
      : null;
  const reason =
    error instanceof z.ZodError
      ? error.issues
          .slice(0, 4)
          .map(
            (issue) =>
              `${issue.path.length > 0 ? issue.path.join('.') : 'record'}:${issue.code}`,
          )
          .join(',')
      : 'record:normalization_failed';

  return {
    sourceEventId,
    reason,
    rawJson: (JSON.stringify(rawEvent) ?? 'null').slice(0, 2_000),
  };
}

export async function fetchAfadWindowWithDiagnostics(
  start: Date,
  end: Date,
  fetcher: typeof fetch = fetch,
  options: AfadFetchOptions = {},
): Promise<AfadWindowResult> {
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

  const maxAttempts = Math.min(5, Math.max(1, options.maxAttempts ?? 3));
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 10_000);
  const sleep =
    options.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  let response: Response | null = null;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      response = await fetcher(url, {
        headers: { Accept: 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempts >= maxAttempts) {
        const timedOut = (error as Error).name === 'TimeoutError';
        throw new AfadSourceError(
          timedOut ? 'AFAD_TIMEOUT' : 'AFAD_NETWORK_ERROR',
          timedOut
            ? `AFAD did not respond within ${timeoutMs}ms.`
            : 'AFAD could not be reached.',
          attempts,
        );
      }
      await sleep(250 * 2 ** (attempts - 1));
      continue;
    }

    if (response.ok) break;
    if (!retryableStatus(response.status) || attempts >= maxAttempts) {
      throw new AfadSourceError(
        `AFAD_HTTP_${response.status}`,
        `AFAD returned HTTP ${response.status}.`,
        attempts,
      );
    }
    await sleep(250 * 2 ** (attempts - 1));
  }

  if (!response) {
    throw new AfadSourceError(
      'AFAD_NETWORK_ERROR',
      'AFAD could not be reached.',
      attempts,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AfadSourceError(
      'AFAD_INVALID_JSON',
      'AFAD returned invalid JSON.',
      attempts,
    );
  }

  const rawEvents = z.array(z.unknown()).safeParse(payload);
  if (!rawEvents.success) {
    throw new AfadSourceError(
      'AFAD_INVALID_PAYLOAD',
      'AFAD returned an unexpected payload shape.',
      attempts,
    );
  }

  const eventsById = new Map<string, NormalizedSourceEvent>();
  const rejections: AfadRejectedRecord[] = [];
  let rejected = 0;
  let duplicatesDropped = 0;

  for (const rawEvent of rawEvents.data) {
    try {
      const event = normalizeAfadEvent(rawEvent);
      const existing = eventsById.get(event.sourceEventId);
      if (existing) {
        duplicatesDropped += 1;
        if (sourceUpdateTime(event) >= sourceUpdateTime(existing)) {
          eventsById.set(event.sourceEventId, event);
        }
      } else {
        eventsById.set(event.sourceEventId, event);
      }
    } catch (error) {
      rejected += 1;
      if (rejections.length < 25) {
        rejections.push(rejectedRecord(rawEvent, error));
      }
    }
  }

  if (rawEvents.data.length > 0 && eventsById.size === 0) {
    throw new AfadSourceError(
      'AFAD_NO_VALID_EVENTS',
      'AFAD returned records, but none passed validation.',
      attempts,
      rejections,
    );
  }

  return {
    events: [...eventsById.values()],
    rejections,
    attempts,
    received: rawEvents.data.length,
    rejected,
    duplicatesDropped,
  };
}

export async function fetchAfadWindow(
  start: Date,
  end: Date,
  fetcher: typeof fetch = fetch,
) {
  return (await fetchAfadWindowWithDiagnostics(start, end, fetcher)).events;
}
