'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  CatalogEvent,
  EventsResponse,
  SourceHealthResponse,
} from '@/shared/schemas';
import type { AtlasFilters, MapBounds } from '@/shared/atlas-state';

type CatalogState = 'loading' | 'ready' | 'error';

export function useRecentEvents(filters: AtlasFilters, bounds: MapBounds | null) {
  const [events, setEvents] = useState<CatalogEvent[]>([]);
  const [health, setHealth] = useState<SourceHealthResponse['AFAD'] | null>(null);
  const [state, setState] = useState<CatalogState>('loading');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const end = new Date();
        const start = new Date(end.valueOf() - 7 * 24 * 60 * 60 * 1_000);
        start.setTime(end.valueOf() - filters.rangeHours * 60 * 60 * 1_000);
        const params = new URLSearchParams({
          start: start.toISOString(),
          end: end.toISOString(),
          source: 'AFAD',
          limit: '2500',
          minMag: String(filters.minMagnitude),
          maxDepth: String(filters.maxDepth),
        });

        if (bounds) {
          params.set('minLat', bounds.minLat.toFixed(3));
          params.set('maxLat', bounds.maxLat.toFixed(3));
          params.set('minLon', bounds.minLon.toFixed(3));
          params.set('maxLon', bounds.maxLon.toFixed(3));
        }

        const [eventsResponse, healthResponse] = await Promise.all([
          fetch(`/api/v1/events?${params}`, { signal: controller.signal }),
          fetch('/api/v1/source-health', { signal: controller.signal }),
        ]);

        if (!eventsResponse.ok || !healthResponse.ok) {
          throw new Error('The stored catalog could not be loaded.');
        }

        const eventPayload = (await eventsResponse.json()) as EventsResponse;
        const healthPayload = (await healthResponse.json()) as SourceHealthResponse;
        setEvents(eventPayload.events);
        setHealth(healthPayload.AFAD);
        setState('ready');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setState('error');
      }
    }

    void load();
    const interval = window.setInterval(load, 60_000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [
    bounds?.maxLat,
    bounds?.maxLon,
    bounds?.minLat,
    bounds?.minLon,
    filters.maxDepth,
    filters.minMagnitude,
    filters.rangeHours,
    refreshKey,
  ]);

  return { events, health, state, refresh };
}
