import { z } from 'zod';
import {
  NormalizedSourceEventSchema,
  type NormalizedSourceEvent,
} from '@/shared/schemas';

const AFAD_API_URL = 'https://deprem.afad.gov.tr/apiv2/event/filter';
const AFAD_RESPONSE_LIMIT = 2_500;
const MAX_WINDOW_SPLITS = 63;
const AFAD_CLIENT_IDENTITY =
  'SeismicAtlas/0.5 (+https://github.com/frknuynk/seismic-atlas)';

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
  splits: number;
  received: number;
  rejected: number;
  duplicatesDropped: number;
};

export type AfadRejectedRecord = {
  sourceEventId: string | null;
  reason: string;
  rawJson: string;
};

export type AfadFetchProgress = {
  attempts: number;
  splits: number;
};

export type AfadFetchOptions = {
  beforeRequest?: (progress: AfadFetchProgress) => Promise<void>;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  maxSplits?: number;
  now?: () => number;
  random?: () => number;
  responseLimit?: number;
  retryBaseMs?: number;
  timeoutMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

type FetchMetrics = {
  attempts: number;
  splits: number;
};

type PendingWindow = {
  start: Date;
  end: Date;
};

export class AfadSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly attempts: number,
    readonly rejections: AfadRejectedRecord[] = [],
    readonly splits = 0,
    readonly retryAfterMs: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
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

export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }

  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - now);
}

function retryDelay({
  attempt,
  baseMs,
  random,
  retryAfterMs,
}: {
  attempt: number;
  baseMs: number;
  random: () => number;
  retryAfterMs: number | null;
}) {
  const exponential = baseMs * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(exponential * 0.25 * random());
  return Math.max(retryAfterMs ?? 0, exponential + jitter);
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

function afadWindowUrl(start: Date, end: Date, responseLimit: number) {
  const url = new URL(AFAD_API_URL);
  url.searchParams.set('start', toAfadTime(start));
  url.searchParams.set('end', toAfadTime(end));
  url.searchParams.set('minlat', '34');
  url.searchParams.set('maxlat', '43');
  url.searchParams.set('minlon', '23');
  url.searchParams.set('maxlon', '46');
  url.searchParams.set('orderby', 'timedesc');
  url.searchParams.set('limit', String(responseLimit));
  url.searchParams.set('format', 'json');
  return url;
}

async function fetchRawAfadWindow(
  window: PendingWindow,
  fetcher: typeof fetch,
  options: Required<
    Pick<
      AfadFetchOptions,
      | 'maxAttempts'
      | 'maxRetryDelayMs'
      | 'now'
      | 'random'
      | 'responseLimit'
      | 'retryBaseMs'
      | 'timeoutMs'
    >
  > & {
    beforeRequest?: AfadFetchOptions['beforeRequest'];
    sleep: NonNullable<AfadFetchOptions['sleep']>;
  },
  metrics: FetchMetrics,
) {
  const url = afadWindowUrl(window.start, window.end, options.responseLimit);
  let response: Response | null = null;
  let windowAttempts = 0;

  while (windowAttempts < options.maxAttempts) {
    await options.beforeRequest?.({ ...metrics });
    windowAttempts += 1;
    metrics.attempts += 1;
    try {
      response = await fetcher(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': AFAD_CLIENT_IDENTITY,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      if (windowAttempts >= options.maxAttempts) {
        const timedOut = (error as Error).name === 'TimeoutError';
        throw new AfadSourceError(
          timedOut ? 'AFAD_TIMEOUT' : 'AFAD_NETWORK_ERROR',
          timedOut
            ? `AFAD did not respond within ${options.timeoutMs}ms.`
            : 'AFAD could not be reached.',
          metrics.attempts,
          [],
          metrics.splits,
          null,
          { cause: error },
        );
      }
      await options.sleep(
        Math.min(
          options.maxRetryDelayMs,
          retryDelay({
            attempt: windowAttempts,
            baseMs: options.retryBaseMs,
            random: options.random,
            retryAfterMs: null,
          }),
        ),
      );
      continue;
    }

    if (response.ok) break;
    const retryAfterMs = parseRetryAfter(
      response.headers.get('retry-after'),
      options.now(),
    );
    if (
      !retryableStatus(response.status) ||
      windowAttempts >= options.maxAttempts ||
      (retryAfterMs !== null && retryAfterMs > options.maxRetryDelayMs)
    ) {
      throw new AfadSourceError(
        `AFAD_HTTP_${response.status}`,
        `AFAD returned HTTP ${response.status}.`,
        metrics.attempts,
        [],
        metrics.splits,
        retryAfterMs,
      );
    }
    await options.sleep(
      Math.min(
        options.maxRetryDelayMs,
        retryDelay({
          attempt: windowAttempts,
          baseMs: options.retryBaseMs,
          random: options.random,
          retryAfterMs,
        }),
      ),
    );
  }

  if (!response) {
    throw new AfadSourceError(
      'AFAD_NETWORK_ERROR',
      'AFAD could not be reached.',
      metrics.attempts,
      [],
      metrics.splits,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AfadSourceError(
      'AFAD_INVALID_JSON',
      'AFAD returned invalid JSON.',
      metrics.attempts,
      [],
      metrics.splits,
    );
  }

  const rawEvents = z.array(z.unknown()).safeParse(payload);
  if (!rawEvents.success) {
    throw new AfadSourceError(
      'AFAD_INVALID_PAYLOAD',
      'AFAD returned an unexpected payload shape.',
      metrics.attempts,
      [],
      metrics.splits,
    );
  }

  return rawEvents.data;
}

export async function fetchAfadWindowWithDiagnostics(
  start: Date,
  end: Date,
  fetcher: typeof fetch = fetch,
  options: AfadFetchOptions = {},
): Promise<AfadWindowResult> {
  if (
    !Number.isFinite(start.valueOf()) ||
    !Number.isFinite(end.valueOf()) ||
    end.valueOf() <= start.valueOf()
  ) {
    throw new AfadSourceError(
      'AFAD_INVALID_WINDOW',
      'AFAD synchronization requires a valid ascending time window.',
      0,
    );
  }

  const fetchOptions = {
    beforeRequest: options.beforeRequest,
    maxAttempts: Math.min(5, Math.max(1, options.maxAttempts ?? 3)),
    maxRetryDelayMs: Math.min(
      30_000,
      Math.max(2_000, options.maxRetryDelayMs ?? 30_000),
    ),
    maxSplits: Math.min(
      MAX_WINDOW_SPLITS,
      Math.max(0, options.maxSplits ?? MAX_WINDOW_SPLITS),
    ),
    now: options.now ?? Date.now,
    random: options.random ?? Math.random,
    responseLimit: Math.min(
      AFAD_RESPONSE_LIMIT,
      Math.max(1, options.responseLimit ?? AFAD_RESPONSE_LIMIT),
    ),
    retryBaseMs: Math.min(10_000, Math.max(500, options.retryBaseMs ?? 2_000)),
    timeoutMs: Math.max(1_000, options.timeoutMs ?? 10_000),
    sleep:
      options.sleep ??
      ((delayMs: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, delayMs))),
  };
  const metrics: FetchMetrics = { attempts: 0, splits: 0 };
  const pendingWindows: PendingWindow[] = [{ start, end }];
  const eventsById = new Map<string, NormalizedSourceEvent>();
  const rejections: AfadRejectedRecord[] = [];
  let received = 0;
  let rejected = 0;
  let duplicatesDropped = 0;

  while (pendingWindows.length > 0) {
    const window = pendingWindows.pop();
    if (!window) break;
    const rawEvents = await fetchRawAfadWindow(
      window,
      fetcher,
      fetchOptions,
      metrics,
    );

    if (rawEvents.length >= fetchOptions.responseLimit) {
      const startSecond = Math.floor(window.start.valueOf() / 1_000);
      const endSecond = Math.floor(window.end.valueOf() / 1_000);
      if (endSecond - startSecond <= 1) {
        throw new AfadSourceError(
          'AFAD_WINDOW_SATURATED',
          `AFAD returned ${fetchOptions.responseLimit} records for a one-second window; completeness cannot be guaranteed.`,
          metrics.attempts,
          [],
          metrics.splits,
        );
      }
      if (metrics.splits >= fetchOptions.maxSplits) {
        throw new AfadSourceError(
          'AFAD_SPLIT_LIMIT',
          'AFAD saturation exceeded the bounded window-split budget; completeness cannot be guaranteed.',
          metrics.attempts,
          [],
          metrics.splits,
        );
      }

      const midpoint = new Date(
        (startSecond + Math.floor((endSecond - startSecond) / 2)) * 1_000,
      );
      metrics.splits += 1;
      // AFAD time filters are second-granular and inclusive. The shared midpoint
      // deliberately overlaps; source-event ID deduplication removes the boundary.
      pendingWindows.push({ start: midpoint, end: window.end });
      pendingWindows.push({ start: window.start, end: midpoint });
      continue;
    }

    received += rawEvents.length;
    for (const rawEvent of rawEvents) {
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
  }

  if (received > 0 && eventsById.size === 0) {
    throw new AfadSourceError(
      'AFAD_NO_VALID_EVENTS',
      'AFAD returned records, but none passed validation.',
      metrics.attempts,
      rejections,
      metrics.splits,
    );
  }

  return {
    events: [...eventsById.values()],
    rejections,
    attempts: metrics.attempts,
    splits: metrics.splits,
    received,
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
