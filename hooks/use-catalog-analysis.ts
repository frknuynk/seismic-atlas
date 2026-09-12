'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  catalogAnalysisKey,
  type CatalogAnalysis,
} from '@/lib/science/catalog-analysis';
import type { CatalogEvent } from '@/shared/schemas';

type AnalysisState =
  | { status: 'blocked'; analysis: null }
  | { status: 'loading'; analysis: null }
  | { status: 'ready'; analysis: CatalogAnalysis }
  | { status: 'refreshing'; analysis: CatalogAnalysis }
  | { status: 'error'; analysis: CatalogAnalysis | null };

export function useCatalogAnalysis(events: CatalogEvent[], enabled = true) {
  const analysisKey = useMemo(() => catalogAnalysisKey(events), [events]);
  const [state, setState] = useState<AnalysisState>(() =>
    enabled
      ? { status: 'loading', analysis: null }
      : { status: 'blocked', analysis: null },
  );

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'blocked', analysis: null });
      return;
    }

    const requestId = crypto.randomUUID();
    const worker = new Worker(
      new URL('../workers/catalog-analysis.worker.ts', import.meta.url),
      { type: 'module' },
    );

    setState((current) =>
      current.analysis
        ? { status: 'refreshing', analysis: current.analysis }
        : { status: 'loading', analysis: null },
    );
    worker.onmessage = (
      message: MessageEvent<{
        requestId: string;
        analysis: CatalogAnalysis;
      }>,
    ) => {
      if (message.data.requestId !== requestId) return;
      setState({ status: 'ready', analysis: message.data.analysis });
    };
    worker.onerror = () =>
      setState((current) => ({
        status: 'error',
        analysis: current.analysis,
      }));
    worker.postMessage({ requestId, events });

    return () => worker.terminate();
  }, [analysisKey, enabled]);

  return state;
}
