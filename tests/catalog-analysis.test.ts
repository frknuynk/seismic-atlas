import { describe, expect, it } from 'vitest';
import {
  analyzeCatalog,
  catalogAnalysisFingerprint,
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
    expect(catalogAnalysisKey([{ ...cloned[0], longitude: 35.5 }])).not.toBe(
      catalogAnalysisKey(original),
    );
    expect(catalogAnalysisKey([{ ...cloned[0], place: null }])).not.toBe(
      catalogAnalysisKey(original),
    );
    expect(
      catalogAnalysisFingerprint([{ ...cloned[0], revisionCount: 2 }]),
    ).not.toBe(catalogAnalysisFingerprint(original));
  });

  it('keeps small magnitude groups separate without unsupported plots', () => {
    const analysis = analyzeCatalog([
      event(1, 1.2, 4),
      event(2, 1.8, 8),
      event(3, 2.1, 12),
      event(4, null, null),
    ]);

    expect(analysis).toMatchObject({
      eventCount: 4,
      magnitudeCoveragePercent: 75,
      depthCoveragePercent: 75,
      sequences: {
        candidateCount: 1,
        clusteredEventCount: 4,
        unclusteredEventCount: 0,
      },
      quality: { status: 'limited' },
    });
    expect(
      analysis.timeHistogram.reduce((sum, bin) => sum + bin.count, 0),
    ).toBe(4);
    expect(analysis.magnitudeGroups).toEqual([
      {
        type: 'ML',
        count: 4,
        maximum: 2.1,
        histogram: [],
        frequencyMagnitude: [],
      },
    ]);
    expect(analysis.depthHistogram.map((bin) => bin.count)).toEqual([
      1, 1, 1, 0, 0, 0,
    ]);
  });

  it('creates histograms and frequency curves only within eligible types', () => {
    const events = Array.from({ length: 60 }, (_, index) =>
      event(index, 1 + index / 20, 5, index < 50 ? 'ML' : 'MW'),
    );
    const analysis = analyzeCatalog(events);
    const ml = analysis.magnitudeGroups.find((group) => group.type === 'ML')!;
    const mw = analysis.magnitudeGroups.find((group) => group.type === 'MW')!;

    expect(ml.count).toBe(50);
    expect(ml.histogram.reduce((sum, bin) => sum + bin.count, 0)).toBe(50);
    expect(ml.frequencyMagnitude.length).toBeGreaterThan(0);
    expect(mw.count).toBe(10);
    expect(mw.histogram.reduce((sum, bin) => sum + bin.count, 0)).toBe(10);
    expect(mw.frequencyMagnitude).toEqual([]);
  });

  it('returns an explicit empty analysis without invalid numbers', () => {
    expect(analyzeCatalog([])).toMatchObject({
      eventCount: 0,
      firstEventTime: null,
      lastEventTime: null,
      magnitudeCoveragePercent: 0,
      depthCoveragePercent: 0,
      magnitudeGroups: [],
      sequences: { candidateCount: 0, clusteredEventCount: 0 },
      quality: { status: 'empty' },
    });
  });
});
