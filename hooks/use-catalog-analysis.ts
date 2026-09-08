'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  catalogAnalysisKey,
  type CatalogAnalysis,
} from '@/lib/science/catalog-analysis';
import type { CatalogEvent } from '@/shared/schemas';

type AnalysisState =
  | { status: 'loading'; analysis: null }
  | { status: 'ready'; analysis: CatalogAnalysis }
  | { status: 'refreshing'; analysis: CatalogAnalysis }
  | { status: 'error'; analysis: CatalogAnalysis | null };

export function useCatalogAnalysis(events: CatalogEvent[]) {
  const analysisKey = useMemo(() => catalogAnalysisKey(events), [events]);
  const [state, setState] = useState<AnalysisState>({
    status: 'loading',
    analysis: null,
  });

  useEffect(() => {
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
  }, [analysisKey]);

  return state;
}
