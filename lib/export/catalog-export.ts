import {
  CATALOG_ANALYSIS_VERSION,
  type CatalogAnalysis,
} from '@/lib/science/catalog-analysis';
import type {
  AtlasFilters,
  MapBounds,
  TimelineWindow,
} from '@/shared/atlas-state';
import type { CatalogEvent } from '@/shared/schemas';

export type CatalogExportContext = {
  filters: AtlasFilters;
  bounds: MapBounds | null;
  timelineWindow: TimelineWindow | null;
  generatedAt?: string;
};

function csvCell(value: string | number | null) {
  if (value === null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function catalogCsv(events: CatalogEvent[]) {
  const columns = [
    'source',
    'source_event_id',
    'origin_time',
    'latitude',
    'longitude',
    'depth_km',
    'magnitude',
    'magnitude_type',
    'place',
    'revision_count',
  ];
  const rows = events.map((event) =>
    [
      event.source,
      event.sourceEventId,
      event.originTime,
      event.latitude,
      event.longitude,
      event.depthKm,
      event.magnitude,
      event.magnitudeType,
      event.place,
      event.revisionCount,
    ]
      .map(csvCell)
      .join(','),
  );
  return [columns.join(','), ...rows].join('\n');
}

export function catalogGeoJson(events: CatalogEvent[]) {
  return {
    type: 'FeatureCollection' as const,
    features: events.map((event) => ({
      type: 'Feature' as const,
      id: event.id,
      geometry: {
        type: 'Point' as const,
        coordinates: [event.longitude, event.latitude],
      },
      properties: {
        source: event.source,
        sourceEventId: event.sourceEventId,
        originTime: event.originTime,
        depthKm: event.depthKm,
        magnitude: event.magnitude,
        magnitudeType: event.magnitudeType,
        place: event.place,
        revisionCount: event.revisionCount,
      },
    })),
  };
}

export function analysisManifest(
  events: CatalogEvent[],
  analysis: CatalogAnalysis,
  context: CatalogExportContext,
) {
  return {
    schema: 'seismic-atlas-analysis-manifest/v1',
    generatedAt: context.generatedAt ?? new Date().toISOString(),
    product: {
      name: 'Seismic Atlas',
      analysisVersion: CATALOG_ANALYSIS_VERSION,
    },
    catalog: {
      sources: ['AFAD'],
      eventCount: events.length,
      eventIds: events.map((event) => event.id),
      firstEventTime: analysis.firstEventTime,
      lastEventTime: analysis.lastEventTime,
      magnitudeTypes: analysis.magnitudeTypes,
    },
    selection: {
      region: context.bounds
        ? {
            type: 'bbox',
            minLatitude: context.bounds.minLat,
            maxLatitude: context.bounds.maxLat,
            minLongitude: context.bounds.minLon,
            maxLongitude: context.bounds.maxLon,
          }
        : { type: 'initial-map-view' },
      filters: context.filters,
      timelineWindow: context.timelineWindow,
    },
    methods: {
      timeHistogram: { bins: analysis.timeHistogram.length },
      magnitudeHistogram: { binWidth: 0.5 },
      depthHistogram: { boundariesKm: [0, 5, 10, 20, 40, 70] },
      frequencyMagnitude: {
        binWidth: 0.1,
        completeness: 'not-estimated',
        bValue: 'not-computed',
      },
      declustering: 'none',
    },
    limitations: analysis.quality.messages,
  };
}
