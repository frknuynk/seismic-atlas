'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  SourceHealthResponseSchema,
  type CatalogEvent,
  type SourceHealthResponse,
} from '@/shared/schemas';
import type { AtlasFilters, MapBounds } from '@/shared/atlas-state';
import {
  fetchCatalogPages,
  type CatalogCompleteness,
  verifyCatalogGeneration,
} from '@/lib/api/catalog-pages';

type CatalogState = 'loading' | 'ready' | 'error';

export function useRecentEvents(
  filters: AtlasFilters,
  bounds: MapBounds | null,
) {
  const [events, setEvents] = useState<CatalogEvent[]>([]);
  const [health, setHealth] = useState<SourceHealthResponse['AFAD'] | null>(
    null,
  );
  const [state, setState] = useState<CatalogState>('loading');
  const [completeness, setCompleteness] = useState<CatalogCompleteness>({
    complete: false,
    loaded: 0,
    total: null,
    reason: 'loading',
  });
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
          minMag: String(filters.minMagnitude),
          maxDepth: String(filters.maxDepth),
        });

        if (bounds) {
          params.set('minLat', bounds.minLat.toFixed(3));
          params.set('maxLat', bounds.maxLat.toFixed(3));
          params.set('minLon', bounds.minLon.toFixed(3));
          params.set('maxLon', bounds.maxLon.toFixed(3));
        }

        const loadHealth = async () => {
          const response = await fetch('/api/v1/source-health', {
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error('Catalog source health could not be loaded.');
          }
          return SourceHealthResponseSchema.parse(await response.json());
        };
        const healthBefore = await loadHealth();
        const catalog = await fetchCatalogPages(params, {
          signal: controller.signal,
        });
        const healthPayload: SourceHealthResponse = await loadHealth();
        const verifiedCompleteness = verifyCatalogGeneration(
          catalog.completeness,
          healthBefore.AFAD,
          healthPayload.AFAD,
        );

        setEvents(catalog.events);
        setCompleteness(verifiedCompleteness);
        setHealth(healthPayload.AFAD);
        setState('ready');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setState('error');
          setCompleteness((current) => ({
            complete: false,
            loaded: current.loaded,
            total: current.total,
            reason: 'request_failed',
          }));
        }
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

  return { events, health, state, completeness, refresh };
}
