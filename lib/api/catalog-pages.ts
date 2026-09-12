import { EventsResponseSchema, type CatalogEvent } from '@/shared/schemas';

export const CATALOG_PAGE_SIZE = 2_500;
export const MAX_BROWSER_CATALOG_EVENTS = 25_000;

export type CatalogCompletenessReason =
  | 'loading'
  | 'client_cap'
  | 'catalog_changed'
  | 'count_mismatch'
  | 'pagination_protocol'
  | 'request_failed'
  | 'ingestion_running';

export type CatalogCompleteness = {
  complete: boolean;
  loaded: number;
  total: number | null;
  reason: CatalogCompletenessReason | null;
};

type CatalogGeneration = {
  lastSuccessAt: string | null;
  lastRun: {
    id: string;
    status: 'running' | 'succeeded' | 'failed';
  } | null;
};

export function verifyCatalogGeneration(
  completeness: CatalogCompleteness,
  before: CatalogGeneration,
  after: CatalogGeneration,
): CatalogCompleteness {
  if (
    before.lastRun?.status === 'running' ||
    after.lastRun?.status === 'running'
  ) {
    return { ...completeness, complete: false, reason: 'ingestion_running' };
  }
  if (before.lastSuccessAt !== after.lastSuccessAt) {
    return { ...completeness, complete: false, reason: 'catalog_changed' };
  }
  if (before.lastRun?.id !== after.lastRun?.id) {
    return { ...completeness, complete: false, reason: 'catalog_changed' };
  }
  return completeness;
}

type CatalogPagesOptions = {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  pageSize?: number;
  maxEvents?: number;
};

export async function fetchCatalogPages(
  params: URLSearchParams,
  options: CatalogPagesOptions = {},
): Promise<{ events: CatalogEvent[]; completeness: CatalogCompleteness }> {
  const fetcher = options.fetcher ?? fetch;
  const pageSize = Math.min(
    Math.max(1, Math.trunc(options.pageSize ?? CATALOG_PAGE_SIZE)),
    CATALOG_PAGE_SIZE,
  );
  const maxEvents = Math.max(
    pageSize,
    Math.trunc(options.maxEvents ?? MAX_BROWSER_CATALOG_EVENTS),
  );
  const events: CatalogEvent[] = [];
  const eventIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let expectedTotal: number | null = null;

  while (true) {
    const pageParams = new URLSearchParams(params);
    pageParams.set('limit', String(pageSize));
    if (cursor) pageParams.set('cursor', cursor);
    else pageParams.delete('cursor');

    const response = await fetcher(`/api/v1/events?${pageParams}`, {
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(`Catalog page failed with status ${response.status}.`);
    }

    const page = EventsResponseSchema.parse(await response.json());
    if (
      page.meta.count !== page.events.length ||
      page.meta.returned !== page.events.length ||
      page.events.length > pageSize
    ) {
      return {
        events,
        completeness: {
          complete: false,
          loaded: events.length,
          total: expectedTotal ?? page.meta.total,
          reason: 'pagination_protocol',
        },
      };
    }
    if (expectedTotal === null) expectedTotal = page.meta.total;
    else if (page.meta.total !== expectedTotal) {
      return {
        events,
        completeness: {
          complete: false,
          loaded: events.length,
          total: page.meta.total,
          reason: 'catalog_changed',
        },
      };
    }

    for (const [index, event] of page.events.entries()) {
      if (eventIds.has(event.id)) {
        return {
          events,
          completeness: {
            complete: false,
            loaded: events.length,
            total: expectedTotal,
            reason: 'pagination_protocol',
          },
        };
      }
      eventIds.add(event.id);
      events.push(event);
      if (
        events.length >= maxEvents &&
        (index < page.events.length - 1 ||
          page.meta.hasMore ||
          events.length < expectedTotal)
      ) {
        return {
          events,
          completeness: {
            complete: false,
            loaded: events.length,
            total: expectedTotal,
            reason: 'client_cap',
          },
        };
      }
    }

    if (!page.meta.hasMore) {
      const complete = events.length === expectedTotal;
      return {
        events,
        completeness: {
          complete,
          loaded: events.length,
          total: expectedTotal,
          reason: complete ? null : 'count_mismatch',
        },
      };
    }

    const nextCursor = page.meta.nextCursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      return {
        events,
        completeness: {
          complete: false,
          loaded: events.length,
          total: expectedTotal,
          reason: 'pagination_protocol',
        },
      };
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}
