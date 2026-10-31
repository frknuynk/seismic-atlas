import type { CatalogQualityResponse } from '@/shared/schemas';
import { getCatalogQuality } from '@/worker/catalog-quality';

export const CATALOG_QUALITY_CACHE_TTL_MS = 15 * 60_000;

type CacheEntry = {
  value: CatalogQualityResponse;
  expiresAt: number;
};

type CatalogQualityLoader = (
  db: D1Database,
  now: number,
) => Promise<CatalogQualityResponse>;

let cache: CacheEntry | null = null;
let pending: Promise<CatalogQualityResponse> | null = null;

export async function getCachedCatalogQuality(
  db: D1Database,
  options: {
    now?: () => number;
    ttlMs?: number;
    load?: CatalogQualityLoader;
  } = {},
) {
  const now = options.now ?? Date.now;
  const currentTime = now();
  if (cache && cache.expiresAt > currentTime) return cache.value;
  if (pending) return pending;

  const ttlMs = options.ttlMs ?? CATALOG_QUALITY_CACHE_TTL_MS;
  const load = options.load ?? getCatalogQuality;
  pending = load(db, currentTime)
    .then((value) => {
      cache = { value, expiresAt: now() + ttlMs };
      return value;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export function resetCatalogQualityCache() {
  cache = null;
  pending = null;
}
