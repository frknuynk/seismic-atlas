import { z } from 'zod';
import type {
  NormalizedSourceEvent,
  SourceCode,
} from '@/shared/schemas';

const MAX_WINDOW_SPLITS = 63;

export type SourceRejectedRecord = {
  sourceEventId: string | null;
  reason: string;
  rawJson: string;
};

export type SourceFetchProgress = {
  attempts: number;
  splits: number;
};

export type SourceWindowResult = {
  events: NormalizedSourceEvent[];
  rejections: SourceRejectedRecord[];
  attempts: number;
  splits: number;
  received: number;
  rejected: number;
  duplicatesDropped: number;
};

export type FdsnFetchOptions = {
  beforeRequest?: (progress: SourceFetchProgress) => Promise<void>;
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

export class FdsnSourceError extends Error {
  constructor(
    readonly source: SourceCode,
    readonly code: string,
    message: string,
    readonly attempts: number,
    readonly rejections: SourceRejectedRecord[] = [],
    readonly splits = 0,
    readonly retryAfterMs: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = `${source}SourceError`;
  }
}

export type FdsnSourceConfig = {
  source: Extract<SourceCode, 'USGS' | 'EMSC'>;
  clientIdentity: string;
  responseLimit: number;
  buildUrl: (start: Date, end: Date, responseLimit: number) => URL;
  records: (payload: unknown) => unknown[];
  normalize: (record: unknown) => NormalizedSourceEvent;
  sourceEventId: (record: unknown) => string | null;
};

type FetchMetrics = SourceFetchProgress;
type PendingWindow = { start: Date; end: Date };

function parseRetryAfter(value: string | null, now: number) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function retryDelay(
  attempt: number,
  baseMs: number,
  random: () => number,
  retryAfterMs: number | null,
) {
  const exponential = baseMs * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(exponential * 0.25 * random());
  return Math.max(retryAfterMs ?? 0, exponential + jitter);
}

function rejection(
  config: FdsnSourceConfig,
  raw: unknown,
  error: unknown,
): SourceRejectedRecord {
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
    sourceEventId: config.sourceEventId(raw),
    reason,
    rawJson: (JSON.stringify(raw) ?? 'null').slice(0, 2_000),
  };
}

async function fetchRawWindow(
  config: FdsnSourceConfig,
  window: PendingWindow,
  fetcher: typeof fetch,
  options: Required<
    Pick<
      FdsnFetchOptions,
      | 'maxAttempts'
      | 'maxRetryDelayMs'
      | 'now'
      | 'random'
      | 'responseLimit'
      | 'retryBaseMs'
      | 'timeoutMs'
    >
  > & {
    beforeRequest?: FdsnFetchOptions['beforeRequest'];
    sleep: NonNullable<FdsnFetchOptions['sleep']>;
  },
  metrics: FetchMetrics,
) {
  const url = config.buildUrl(
    window.start,
    window.end,
    options.responseLimit,
  );
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
          'User-Agent': config.clientIdentity,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      if (windowAttempts >= options.maxAttempts) {
        const timedOut = (error as Error).name === 'TimeoutError';
        throw new FdsnSourceError(
          config.source,
          `${config.source}_${timedOut ? 'TIMEOUT' : 'NETWORK_ERROR'}`,
          timedOut
            ? `${config.source} did not respond within ${options.timeoutMs}ms.`
            : `${config.source} could not be reached.`,
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
          retryDelay(
            windowAttempts,
            options.retryBaseMs,
            options.random,
            null,
          ),
        ),
      );
      continue;
    }

    if (response.ok || response.status === 204) break;
    const retryAfterMs = parseRetryAfter(
      response.headers.get('retry-after'),
      options.now(),
    );
    const retryable =
      response.status === 408 || response.status === 429 || response.status >= 500;
    if (
      !retryable ||
      windowAttempts >= options.maxAttempts ||
      (retryAfterMs !== null && retryAfterMs > options.maxRetryDelayMs)
    ) {
      throw new FdsnSourceError(
        config.source,
        `${config.source}_HTTP_${response.status}`,
        `${config.source} returned HTTP ${response.status}.`,
        metrics.attempts,
        [],
        metrics.splits,
        retryAfterMs,
      );
    }
    await options.sleep(
      Math.min(
        options.maxRetryDelayMs,
        retryDelay(
          windowAttempts,
          options.retryBaseMs,
          options.random,
          retryAfterMs,
        ),
      ),
    );
  }

  if (!response) {
    throw new FdsnSourceError(
      config.source,
      `${config.source}_NETWORK_ERROR`,
      `${config.source} could not be reached.`,
      metrics.attempts,
      [],
      metrics.splits,
    );
  }
  if (response.status === 204) return [];

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new FdsnSourceError(
      config.source,
      `${config.source}_INVALID_JSON`,
      `${config.source} returned invalid JSON.`,
      metrics.attempts,
      [],
      metrics.splits,
    );
  }

  try {
    return config.records(payload);
  } catch (error) {
    throw new FdsnSourceError(
      config.source,
      `${config.source}_INVALID_PAYLOAD`,
      `${config.source} returned an unexpected payload shape.`,
      metrics.attempts,
      [],
      metrics.splits,
      null,
      { cause: error },
    );
  }
}

export async function fetchFdsnWindowWithDiagnostics(
  config: FdsnSourceConfig,
  start: Date,
  end: Date,
  fetcher: typeof fetch = fetch,
  options: FdsnFetchOptions = {},
): Promise<SourceWindowResult> {
  if (
    !Number.isFinite(start.valueOf()) ||
    !Number.isFinite(end.valueOf()) ||
    end.valueOf() <= start.valueOf()
  ) {
    throw new FdsnSourceError(
      config.source,
      `${config.source}_INVALID_WINDOW`,
      `${config.source} synchronization requires a valid ascending time window.`,
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
      config.responseLimit,
      Math.max(1, options.responseLimit ?? config.responseLimit),
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
  const rejections: SourceRejectedRecord[] = [];
  let received = 0;
  let rejected = 0;
  let duplicatesDropped = 0;

  while (pendingWindows.length > 0) {
    const window = pendingWindows.pop();
    if (!window) break;
    const rawEvents = await fetchRawWindow(
      config,
      window,
      fetcher,
      fetchOptions,
      metrics,
    );

    if (rawEvents.length >= fetchOptions.responseLimit) {
      const startSecond = Math.floor(window.start.valueOf() / 1_000);
      const endSecond = Math.floor(window.end.valueOf() / 1_000);
      if (endSecond - startSecond <= 1) {
        throw new FdsnSourceError(
          config.source,
          `${config.source}_WINDOW_SATURATED`,
          `${config.source} returned ${fetchOptions.responseLimit} records for a one-second window.`,
          metrics.attempts,
          [],
          metrics.splits,
        );
      }
      if (metrics.splits >= fetchOptions.maxSplits) {
        throw new FdsnSourceError(
          config.source,
          `${config.source}_SPLIT_LIMIT`,
          `${config.source} exceeded the bounded window-split budget.`,
          metrics.attempts,
          [],
          metrics.splits,
        );
      }
      const midpoint = new Date(
        (startSecond + Math.floor((endSecond - startSecond) / 2)) * 1_000,
      );
      metrics.splits += 1;
      pendingWindows.push({ start: midpoint, end: window.end });
      pendingWindows.push({ start: window.start, end: midpoint });
      continue;
    }

    received += rawEvents.length;
    for (const rawEvent of rawEvents) {
      try {
        const event = config.normalize(rawEvent);
        const existing = eventsById.get(event.sourceEventId);
        if (existing) {
          duplicatesDropped += 1;
          const updatedAt = event.sourceUpdatedAt
            ? Date.parse(event.sourceUpdatedAt)
            : 0;
          const existingUpdatedAt = existing.sourceUpdatedAt
            ? Date.parse(existing.sourceUpdatedAt)
            : 0;
          if (updatedAt >= existingUpdatedAt) {
            eventsById.set(event.sourceEventId, event);
          }
        } else {
          eventsById.set(event.sourceEventId, event);
        }
      } catch (error) {
        rejected += 1;
        if (rejections.length < 25) {
          rejections.push(rejection(config, rawEvent, error));
        }
      }
    }
  }

  if (received > 0 && eventsById.size === 0) {
    throw new FdsnSourceError(
      config.source,
      `${config.source}_NO_VALID_EVENTS`,
      `${config.source} returned records, but none passed validation.`,
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
