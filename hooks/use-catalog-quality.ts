'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CatalogQualityResponseSchema,
  type CatalogQualityResponse,
} from '@/shared/schemas';
import {
  CATALOG_QUALITY_POLL_INTERVAL_MS,
  shouldRunScheduledPoll,
} from '@/lib/polling';

type QualityState = 'loading' | 'ready' | 'error';

export function useCatalogQuality(enabled: boolean) {
  const [quality, setQuality] = useState<CatalogQualityResponse | null>(null);
  const [state, setState] = useState<QualityState>('loading');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let inFlight = false;
    let lastStartedAt: number | null = null;

    async function load() {
      const now = Date.now();
      if (
        inFlight ||
        !shouldRunScheduledPoll(
          document.visibilityState,
          lastStartedAt,
          now,
          CATALOG_QUALITY_POLL_INTERVAL_MS,
        )
      ) {
        return;
      }

      inFlight = true;
      lastStartedAt = now;
      try {
        const response = await fetch('/api/v1/data-quality', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Catalog quality is unavailable.');
        setQuality(CatalogQualityResponseSchema.parse(await response.json()));
        setState('ready');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setState('error');
      } finally {
        inFlight = false;
      }
    }

    void load();
    const interval = window.setInterval(
      load,
      CATALOG_QUALITY_POLL_INTERVAL_MS,
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, refreshKey]);

  return { quality, state, refresh };
}
