import { describe, expect, it } from 'vitest';
import {
  analysisManifest,
  catalogCsv,
  catalogGeoJson,
} from '@/lib/export/catalog-export';
import { analyzeCatalog } from '@/lib/science/catalog-analysis';
import type { CatalogEvent } from '@/shared/schemas';

const event: CatalogEvent = {
  id: 'AFAD:42',
  source: 'AFAD',
  sourceEventId: '42',
  originTime: '2026-09-08T12:00:00.000Z',
  latitude: 39,
  longitude: 35,
  depthKm: 7.4,
  magnitude: 2.1,
  magnitudeType: 'ML',
  place: 'Test, Türkiye',
  revisionCount: 2,
};

describe('catalog exports', () => {
  it('escapes CSV fields and preserves source values', () => {
    const csv = catalogCsv([event]);

    expect(csv).toContain('source_event_id,origin_time');
    expect(csv).toContain('AFAD,42,2026-09-08T12:00:00.000Z');
    expect(csv).toContain('"Test, Türkiye"');
  });

  it('creates point GeoJSON with event provenance properties', () => {
    expect(catalogGeoJson([event])).toMatchObject({
      type: 'FeatureCollection',
      features: [
        {
          id: 'AFAD:42',
          geometry: { type: 'Point', coordinates: [35, 39] },
          properties: { source: 'AFAD', sourceEventId: '42' },
        },
      ],
    });
  });

  it('records selection and explicit scientific non-results', () => {
    const manifest = analysisManifest([event], analyzeCatalog([event]), {
      filters: { rangeHours: 168, minMagnitude: 0, maxDepth: 300 },
      bounds: { minLat: 38, maxLat: 40, minLon: 34, maxLon: 36 },
      timelineWindow: null,
      generatedAt: '2026-09-09T00:00:00.000Z',
    });

    expect(manifest).toMatchObject({
      schema: 'seismic-atlas-analysis-manifest/v1',
      catalog: { eventCount: 1, eventIds: ['AFAD:42'] },
      selection: { region: { type: 'bbox', minLatitude: 38 } },
      methods: {
        frequencyMagnitude: {
          completeness: 'not-estimated',
          bValue: 'not-computed',
        },
        declustering: 'none',
      },
    });
  });
});
