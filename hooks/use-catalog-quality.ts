'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CatalogQualityResponseSchema,
  type CatalogQualityResponse,
} from '@/shared/schemas';

type QualityState = 'loading' | 'ready' | 'error';

export function useCatalogQuality() {
  const [quality, setQuality] = useState<CatalogQualityResponse | null>(null);
  const [state, setState] = useState<QualityState>('loading');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch('/api/v1/data-quality', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Catalog quality is unavailable.');
        setQuality(CatalogQualityResponseSchema.parse(await response.json()));
        setState('ready');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setState('error');
      }
    }

    void load();
    const interval = window.setInterval(load, 5 * 60_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshKey]);

  return { quality, state, refresh };
}
