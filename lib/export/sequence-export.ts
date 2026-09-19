import {
  analysisManifest,
  catalogCsv,
  catalogGeoJson,
  type CatalogExportContext,
} from '@/lib/export/catalog-export';
import {
  catalogAnalysisFingerprint,
  type CatalogAnalysis,
} from '@/lib/science/catalog-analysis';
import { buildSequenceInspector } from '@/lib/science/sequence-inspector';
import type { SeismicSequenceCandidate } from '@/lib/science/seismic-sequences';
import type { CatalogEvent } from '@/shared/schemas';

/** Export only an intact candidate from a verified parent catalog selection. */
export function buildSequenceExport(
  candidate: SeismicSequenceCandidate,
  catalog: CatalogEvent[],
  analysis: CatalogAnalysis,
  context: CatalogExportContext,
) {
  const { completeness } = context;
  if (
    !completeness.complete ||
    completeness.total === null ||
    completeness.loaded !== completeness.total ||
    analysis.eventCount !== catalog.length ||
    analysis.catalogFingerprint !== catalogAnalysisFingerprint(catalog)
  ) {
    throw new Error('A complete, current catalog analysis is required.');
  }

  const analyzedCandidate = analysis.sequences.candidates.find(
    (item) => item.id === candidate.id,
  );
  if (
    !analyzedCandidate ||
    analyzedCandidate.eventCount !== candidate.eventCount ||
    analyzedCandidate.eventIds.length !== candidate.eventIds.length ||
    analyzedCandidate.eventIds.some(
      (id, index) => id !== candidate.eventIds[index],
    ) ||
    new Set(candidate.eventIds).size !== candidate.eventIds.length
  ) {
    throw new Error('The candidate no longer matches this catalog analysis.');
  }

  const inspector = buildSequenceInspector(candidate, catalog);
  if (
    !inspector.complete ||
    inspector.observations.length !== candidate.eventCount
  ) {
    throw new Error(
      'A candidate member is missing from the catalog selection.',
    );
  }

  const generatedAt = new Date(context.generatedAt ?? Date.now()).toISOString();
  const events = inspector.observations.map(({ event }) => event);
  const safeCandidateId = candidate.id.replaceAll(/[^a-z0-9-]/gi, '-');
  const fileStem = `seismic-atlas-${safeCandidateId}-${generatedAt.replaceAll(/[-:.]/g, '').slice(0, 15)}Z`;
  const csvFile = `${fileStem}.csv`;
  const geoJsonFile = `${fileStem}.geojson`;

  return {
    fileStem,
    csv: catalogCsv(events),
    geoJson: catalogGeoJson(events),
    manifest: {
      schema: 'seismic-atlas-sequence-export/v1',
      generatedAt,
      parentAnalysis: analysisManifest(catalog, analysis, {
        ...context,
        generatedAt,
      }),
      candidate: {
        ...candidate,
        eventIds: events.map((event) => event.id),
        reportedMagnitudeCount: inspector.magnitudeObservations.length,
        missingMagnitudeCount: inspector.missingMagnitudeCount,
        missingDepthCount: inspector.missingDepthCount,
      },
      files: {
        csv: csvFile,
        geoJson: geoJsonFile,
        manifest: `${fileStem}-methods.json`,
        order: 'origin_time_ascending_then_event_id',
        coordinates: 'WGS84_longitude_latitude',
      },
      interpretation: [
        'Membership is a proximity-based candidate within the verified filtered catalog, not a mainshock/aftershock classification.',
        'Proximity does not establish fault causation, hazard, or future seismicity.',
        'CSV and GeoJSON contain the reported event values at export time; AFAD may later revise them.',
      ],
    },
  };
}
