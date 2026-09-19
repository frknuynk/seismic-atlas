import { describe, expect, it } from 'vitest';
import { buildSequenceExport } from '@/lib/export/sequence-export';
import {
  analyzeCatalog,
  catalogAnalysisFingerprint,
} from '@/lib/science/catalog-analysis';
import type { CatalogCompleteness } from '@/lib/api/catalog-pages';
import type { CatalogEvent } from '@/shared/schemas';

const baseEvent: CatalogEvent = {
  id: 'AFAD:1',
  source: 'AFAD',
  sourceEventId: '1',
  originTime: '2026-09-16T10:00:00.000Z',
  latitude: 39,
  longitude: 35,
  depthKm: 7,
  magnitude: 2.1,
  magnitudeType: 'ML',
  place: 'Test, Türkiye',
  revisionCount: 1,
};

const catalog: CatalogEvent[] = [
  {
    ...baseEvent,
    id: 'AFAD:3',
    sourceEventId: '3',
    originTime: '2026-09-16T12:00:00.000Z',
    longitude: 35.03,
    magnitude: null,
    depthKm: null,
  },
  baseEvent,
  {
    ...baseEvent,
    id: 'AFAD:4',
    sourceEventId: '4',
    originTime: '2026-09-16T11:00:00.000Z',
    latitude: 41,
    longitude: 42,
  },
  {
    ...baseEvent,
    id: 'AFAD:2',
    sourceEventId: '2',
    originTime: '2026-09-16T11:00:00.000Z',
    longitude: 35.01,
    magnitude: 1.8,
  },
];
const analysis = analyzeCatalog(catalog);
const candidate = analysis.sequences.candidates[0]!;
const completeness: CatalogCompleteness = {
  complete: true,
  loaded: 4,
  total: 4,
  reason: null,
};
const context = {
  filters: { rangeHours: 168 as const, minMagnitude: 0, maxDepth: 300 },
  bounds: { minLat: 38, maxLat: 42, minLon: 34, maxLon: 43 },
  timelineWindow: null,
  completeness,
  generatedAt: '2026-09-16T20:30:00.000Z',
};

describe('sequence export', () => {
  it('exports only exact candidate members in chronological order with a reproducible parent manifest', () => {
    const result = buildSequenceExport(candidate, catalog, analysis, context);

    expect(result.fileStem).toBe(
      `seismic-atlas-${candidate.id}-20260916T203000Z`,
    );
    expect(result.csv.split('\n')).toHaveLength(4);
    expect(result.csv).toContain('"Test, Türkiye"');
    expect(result.csv).not.toContain('AFAD,4,');
    expect(result.geoJson.features.map((feature) => feature.id)).toEqual([
      'AFAD:1',
      'AFAD:2',
      'AFAD:3',
    ]);
    expect(result.manifest).toMatchObject({
      schema: 'seismic-atlas-sequence-export/v1',
      generatedAt: context.generatedAt,
      parentAnalysis: {
        catalog: {
          eventCount: 4,
          completeness,
          eventIds: catalog.map((event) => event.id),
        },
        selection: {
          filters: context.filters,
          region: { type: 'bbox', minLatitude: 38 },
        },
        methods: {
          sequenceCandidates: {
            version: 'sequence-candidates-v1',
            method: 'spatiotemporal-single-linkage',
            parameters: {
              maxNeighborDistanceKm: 30,
              maxNeighborTimeHours: 24,
              minEvents: 3,
            },
          },
        },
      },
      candidate: {
        id: candidate.id,
        eventCount: 3,
        eventIds: ['AFAD:1', 'AFAD:2', 'AFAD:3'],
        reportedMagnitudeCount: 2,
        missingMagnitudeCount: 1,
        missingDepthCount: 1,
      },
      files: {
        csv: `${result.fileStem}.csv`,
        geoJson: `${result.fileStem}.geojson`,
        manifest: `${result.fileStem}-methods.json`,
        order: 'origin_time_ascending_then_event_id',
      },
    });
  });

  it('refuses partial catalogs and candidates with missing or altered membership', () => {
    expect(() =>
      buildSequenceExport(candidate, catalog, analysis, {
        ...context,
        completeness: {
          ...completeness,
          complete: false,
          reason: 'count_mismatch',
        },
      }),
    ).toThrow('complete, current catalog');

    expect(() =>
      buildSequenceExport(
        { ...candidate, eventIds: ['AFAD:1', 'AFAD:2', 'AFAD:4'] },
        catalog,
        analysis,
        context,
      ),
    ).toThrow('no longer matches');

    expect(() =>
      buildSequenceExport(
        candidate,
        catalog.filter((event) => event.id !== 'AFAD:3'),
        {
          ...analysis,
          eventCount: 3,
          catalogFingerprint: catalogAnalysisFingerprint(
            catalog.filter((event) => event.id !== 'AFAD:3'),
          ),
        },
        context,
      ),
    ).toThrow('missing from the catalog');

    expect(() =>
      buildSequenceExport(
        candidate,
        catalog.map((event) =>
          event.id === 'AFAD:1' ? { ...event, place: 'Revised place' } : event,
        ),
        analysis,
        context,
      ),
    ).toThrow('complete, current catalog');
  });
});
