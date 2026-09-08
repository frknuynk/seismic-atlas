import { describe, expect, it } from 'vitest';
import {
  analyzeCatalog,
  catalogAnalysisKey,
} from '@/lib/science/catalog-analysis';
import type { CatalogEvent } from '@/shared/schemas';

function event(
  id: number,
  magnitude: number | null,
  depthKm: number | null,
  magnitudeType = 'ML',
): CatalogEvent {
  return {
    id: `AFAD:${id}`,
    source: 'AFAD',
    sourceEventId: String(id),
    originTime: new Date(Date.UTC(2026, 8, 8, id)).toISOString(),
    latitude: 39,
    longitude: 35,
    depthKm,
    magnitude,
    magnitudeType,
    place: 'Türkiye',
    revisionCount: 1,
  };
}

describe('catalog analysis', () => {
  it('keeps the same identity for equivalent catalog payloads', () => {
    const original = [event(1, 2.4, 8)];
    const cloned = original.map((item) => ({ ...item }));

    expect(catalogAnalysisKey(cloned)).toBe(catalogAnalysisKey(original));
    expect(catalogAnalysisKey([{ ...cloned[0], magnitude: 2.5 }])).not.toBe(
      catalogAnalysisKey(original),
    );
  });

  it('computes descriptive coverage, histograms, and cumulative FMD', () => {
    const analysis = analyzeCatalog([
      event(1, 1.2, 4),
      event(2, 1.8, 8),
      event(3, 2.1, 12),
      event(4, null, null),
    ]);

    expect(analysis).toMatchObject({
      eventCount: 4,
      maximumMagnitude: 2.1,
      magnitudeCoveragePercent: 75,
      depthCoveragePercent: 75,
      quality: { status: 'limited' },
    });
    expect(
      analysis.timeHistogram.reduce((sum, bin) => sum + bin.count, 0),
    ).toBe(4);
    expect(
      analysis.magnitudeHistogram.reduce((sum, bin) => sum + bin.count, 0),
    ).toBe(3);
    expect(analysis.depthHistogram.map((bin) => bin.count)).toEqual([
      1, 1, 1, 0, 0, 0,
    ]);
    expect(analysis.frequencyMagnitude[0]).toEqual({
      magnitude: 1.2,
      count: 3,
    });
    expect(analysis.frequencyMagnitude.at(-1)).toEqual({
      magnitude: 2.1,
      count: 1,
    });
  });

  it('returns an explicit empty analysis without invalid numbers', () => {
    expect(analyzeCatalog([])).toMatchObject({
      eventCount: 0,
      firstEventTime: null,
      lastEventTime: null,
      maximumMagnitude: null,
      magnitudeCoveragePercent: 0,
      depthCoveragePercent: 0,
      magnitudeTypes: [],
      quality: { status: 'empty' },
    });
  });
});
