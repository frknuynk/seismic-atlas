import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogQualityResponse } from '@/shared/schemas';
import {
  CATALOG_QUALITY_CACHE_TTL_MS,
  getCachedCatalogQuality,
  resetCatalogQualityCache,
} from '@/worker/catalog-quality-cache';

const quality = {
  generatedAt: '2026-10-02T10:00:00.000Z',
  source: 'AFAD',
  status: 'healthy',
  coverage: { firstEventTime: null, lastEventTime: null },
  counts: {
    total: 0,
    revisedEvents: 0,
    missingMagnitude: 0,
    missingDepth: 0,
    missingMagnitudeType: 0,
    missingPlace: 0,
    invalidCoordinates: 0,
    negativeDepth: 0,
    extremeDepth: 0,
    unusualMagnitude: 0,
    duplicateSourceIds: 0,
  },
  coveragePercent: {
    magnitude: 0,
    depth: 0,
    magnitudeType: 0,
    place: 0,
  },
  ingestionLast7Days: {
    runs: 0,
    fetched: 0,
    accepted: 0,
    rejected: 0,
    duplicatesDropped: 0,
  },
  checks: [],
} satisfies CatalogQualityResponse;

describe('catalog quality cache', () => {
  beforeEach(() => resetCatalogQualityCache());

  it('reuses one audit throughout the free-tier cache window', async () => {
    let now = 1_000;
    const load = vi.fn(async () => quality);
    const db = {} as D1Database;

    expect(await getCachedCatalogQuality(db, { now: () => now, load })).toBe(
      quality,
    );
    now += CATALOG_QUALITY_CACHE_TTL_MS - 1;
    expect(await getCachedCatalogQuality(db, { now: () => now, load })).toBe(
      quality,
    );
    expect(load).toHaveBeenCalledTimes(1);

    now += 1;
    await getCachedCatalogQuality(db, { now: () => now, load });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent cache misses into one D1 audit', async () => {
    let resolve!: (value: CatalogQualityResponse) => void;
    const load = vi.fn(
      () =>
        new Promise<CatalogQualityResponse>((done) => {
          resolve = done;
        }),
    );
    const db = {} as D1Database;

    const first = getCachedCatalogQuality(db, { load });
    const second = getCachedCatalogQuality(db, { load });
    resolve(quality);

    await expect(Promise.all([first, second])).resolves.toEqual([
      quality,
      quality,
    ]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
