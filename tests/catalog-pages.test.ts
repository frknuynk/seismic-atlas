import { describe, expect, it } from 'vitest';
import {
  fetchCatalogPages,
  type CatalogCompleteness,
  verifyCatalogGeneration,
} from '@/lib/api/catalog-pages';
import type { CatalogEvent, EventsResponse } from '@/shared/schemas';

function event(index: number): CatalogEvent {
  return {
    id: `AFAD:${index.toString().padStart(4, '0')}`,
    source: 'AFAD',
    sourceEventId: String(index),
    originTime: new Date(Date.UTC(2026, 8, 9, 12, 0, index)).toISOString(),
    latitude: 39,
    longitude: 35,
    depthKm: 7,
    magnitude: 2.1,
    magnitudeType: 'ML',
    place: 'Türkiye',
    revisionCount: 1,
  };
}

function payload(
  events: CatalogEvent[],
  metadata: {
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
  },
): EventsResponse {
  return {
    meta: {
      count: events.length,
      returned: events.length,
      truncated: metadata.total > events.length,
      source: ['AFAD'],
      freshness: {},
      ...metadata,
    },
    events,
  };
}

describe('complete catalog pagination', () => {
  it('loads every page beyond the single-response limit', async () => {
    const allEvents = Array.from({ length: 2_501 }, (_, index) => event(index));
    const requestedCursors: Array<string | null> = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const href =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(href, 'https://atlas.test');
      const cursor = url.searchParams.get('cursor');
      requestedCursors.push(cursor);
      const page = cursor ? allEvents.slice(2_500) : allEvents.slice(0, 2_500);
      return Response.json(
        payload(page, {
          total: allEvents.length,
          hasMore: cursor === null,
          nextCursor: cursor === null ? 'next_page' : null,
        }),
      );
    }) as typeof fetch;

    const result = await fetchCatalogPages(
      new URLSearchParams({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-10T00:00:00.000Z',
      }),
      { fetcher },
    );

    expect(result.events).toHaveLength(2_501);
    expect(result.completeness).toEqual<CatalogCompleteness>({
      complete: true,
      loaded: 2_501,
      total: 2_501,
      reason: null,
    });
    expect(requestedCursors).toEqual([null, 'next_page']);
  });

  it('returns an explicit incomplete result when the browser safety cap is hit', async () => {
    const fetcher = (async () =>
      Response.json(
        payload([event(1), event(2)], {
          total: 3,
          hasMore: true,
          nextCursor: 'next_page',
        }),
      )) as typeof fetch;

    const result = await fetchCatalogPages(
      new URLSearchParams({
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-10T00:00:00.000Z',
      }),
      { fetcher, pageSize: 2, maxEvents: 2 },
    );

    expect(result.completeness).toEqual({
      complete: false,
      loaded: 2,
      total: 3,
      reason: 'client_cap',
    });
  });

  it('blocks analysis when ingestion overlaps a paginated read', () => {
    const complete: CatalogCompleteness = {
      complete: true,
      loaded: 2_501,
      total: 2_501,
      reason: null,
    };

    expect(
      verifyCatalogGeneration(
        complete,
        { lastSuccessAt: '2026-09-09T12:00:00.000Z', lastRun: null },
        {
          lastSuccessAt: '2026-09-09T12:00:00.000Z',
          lastRun: { id: 'run-2', status: 'running' },
        },
      ),
    ).toMatchObject({ complete: false, reason: 'ingestion_running' });
    expect(
      verifyCatalogGeneration(
        complete,
        { lastSuccessAt: '2026-09-09T12:00:00.000Z', lastRun: null },
        { lastSuccessAt: '2026-09-09T12:01:00.000Z', lastRun: null },
      ),
    ).toMatchObject({ complete: false, reason: 'catalog_changed' });
    expect(
      verifyCatalogGeneration(
        complete,
        {
          lastSuccessAt: '2026-09-09T12:00:00.000Z',
          lastRun: { id: 'run-1', status: 'succeeded' },
        },
        {
          lastSuccessAt: '2026-09-09T12:00:00.000Z',
          lastRun: { id: 'run-2', status: 'succeeded' },
        },
      ),
    ).toMatchObject({ complete: false, reason: 'catalog_changed' });
  });
});
