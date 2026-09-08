/// <reference lib="webworker" />

import { analyzeCatalog } from '@/lib/science/catalog-analysis';
import type { CatalogEvent } from '@/shared/schemas';

type CatalogAnalysisRequest = {
  requestId: string;
  events: CatalogEvent[];
};

self.onmessage = (message: MessageEvent<CatalogAnalysisRequest>) => {
  const { requestId, events } = message.data;
  self.postMessage({ requestId, analysis: analyzeCatalog(events) });
};

export {};
