import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { analyzeCatalog } from '@/lib/science/catalog-analysis';
import { CatalogLab } from '@/components/atlas/catalog-lab';
import { CatalogIntegrity } from '@/components/atlas/catalog-integrity';
import { EventDetailSheet } from '@/components/atlas/event-detail-sheet';
import { SequenceInspector } from '@/components/atlas/sequence-inspector';
import { detectSequenceCandidates } from '@/lib/science/seismic-sequences';
import type {
  CatalogEvent,
  CatalogQualityResponse,
  EventDetail,
} from '@/shared/schemas';

const baseEvent: CatalogEvent = {
  id: 'AFAD:browser',
  source: 'AFAD',
  sourceEventId: 'browser',
  originTime: '2026-10-31T11:00:00.000Z',
  latitude: 39,
  longitude: 35,
  depthKm: 8,
  magnitude: 3.2,
  magnitudeType: 'ML',
  place: null,
  revisionCount: 2,
};

test('presents missing AFAD place and revision labels without loading copy', async () => {
  const detail: EventDetail = {
    ...baseEvent,
    sourceStatus: 'reviewed',
    sourceUpdatedAt: baseEvent.originTime,
    firstSeenAt: baseEvent.originTime,
    lastSeenAt: baseEvent.originTime,
    revisions: [
      {
        revisionNo: 1,
        observedAt: baseEvent.originTime,
        sourceUpdatedAt: baseEvent.originTime,
        originTime: baseEvent.originTime,
        latitude: 39,
        longitude: 35,
        depthKm: 8,
        magnitude: 3.1,
        magnitudeType: 'ML',
        place: null,
      },
      {
        revisionNo: 2,
        observedAt: baseEvent.originTime,
        sourceUpdatedAt: baseEvent.originTime,
        originTime: baseEvent.originTime,
        latitude: 39,
        longitude: 35,
        depthKm: 8,
        magnitude: 3.2,
        magnitudeType: 'ML',
        place: null,
      },
    ],
  };
  const screen = await render(
    <EventDetailSheet
      eventId={baseEvent.id}
      summary={baseEvent}
      detail={detail}
      loading={false}
      nearbyFault={null}
      nearbyFaultLoading={false}
      onOpenChange={() => {}}
    />,
  );
  await expect
    .element(screen.getByText('Location not reported by AFAD').first())
    .toBeVisible();
  await expect
    .element(screen.getByText('Initial observed solution'))
    .toBeVisible();
  await expect.element(screen.getByText('Revision 1')).toBeVisible();
  expect(document.body.textContent).not.toContain('Loading…');
});

test('Catalog Lab keeps ML and MW maxima separate', async () => {
  const events = Array.from(
    { length: 60 },
    (_, index): CatalogEvent => ({
      ...baseEvent,
      id: `AFAD:${index}`,
      sourceEventId: String(index),
      originTime: new Date(Date.UTC(2026, 9, 30, 0, index)).toISOString(),
      longitude: 35 + index / 10_000,
      magnitude: 1 + index / 20,
      magnitudeType: index < 50 ? 'ML' : 'MW',
    }),
  );
  const analysis = analyzeCatalog(events);
  const screen = await render(
    <CatalogLab
      events={events}
      completeness={{ complete: true, loaded: 60, total: 60, reason: null }}
      state={{ status: 'ready', analysis }}
      selectedSequenceId={null}
      focusedSequenceEventId={null}
      onSelectSequence={vi.fn()}
      onFocusSequenceEvent={vi.fn()}
      onSequencePlaybackChange={vi.fn()}
    />,
  );
  await expect.element(screen.getByText(/ML · 50 · max/)).toBeVisible();
  await expect.element(screen.getByText(/MW · 10 · max/)).toBeVisible();
  expect(document.body.textContent).not.toContain('Maximum M');
  expect(document.body.textContent).toContain('ML frequency–magnitude');
  expect(document.body.textContent).not.toContain('MW frequency–magnitude');
});

test('Catalog Integrity exposes coverage and failed checks', async () => {
  const quality: CatalogQualityResponse = {
    generatedAt: baseEvent.originTime,
    source: 'AFAD',
    status: 'critical',
    coverage: {
      firstEventTime: baseEvent.originTime,
      lastEventTime: baseEvent.originTime,
    },
    counts: {
      total: 10,
      revisedEvents: 2,
      missingMagnitude: 1,
      missingDepth: 0,
      missingMagnitudeType: 2,
      missingPlace: 3,
      invalidCoordinates: 0,
      negativeDepth: 0,
      extremeDepth: 0,
      unusualMagnitude: 0,
      duplicateSourceIds: 0,
    },
    coveragePercent: {
      magnitude: 90,
      depth: 100,
      magnitudeType: 80,
      place: 70,
    },
    ingestionLast7Days: {
      runs: 1,
      fetched: 10,
      accepted: 9,
      rejected: 1,
      duplicatesDropped: 0,
    },
    checks: [
      {
        code: 'coverage-failed',
        status: 'fail',
        affected: 3,
        message: 'Place coverage is below threshold.',
      },
    ],
  };
  const screen = await render(
    <CatalogIntegrity quality={quality} state="ready" onRefresh={vi.fn()} />,
  );
  await expect
    .element(screen.getByText('Magnitude type coverage'))
    .toBeVisible();
  await expect.element(screen.getByText('Place coverage')).toBeVisible();
  await screen.getByText('Review affected quality checks').click();
  await expect.element(screen.getByText(/coverage-failed/)).toBeVisible();
  await expect.element(screen.getByText(/3 affected/)).toBeVisible();
});

test('Sequence Inspector presents type-specific maxima and playback controls', async () => {
  const events = Array.from(
    { length: 3 },
    (_, index): CatalogEvent => ({
      ...baseEvent,
      id: `AFAD:sequence-${index}`,
      sourceEventId: `sequence-${index}`,
      originTime: new Date(Date.UTC(2026, 9, 31, 11, index)).toISOString(),
      longitude: 35 + index / 1_000,
      magnitude: 2 + index,
      magnitudeType: index === 2 ? 'MW' : 'ML',
      place: `Event ${index + 1}`,
    }),
  );
  const candidate = detectSequenceCandidates(events).candidates[0]!;
  const onPlaybackChange = vi.fn();
  const screen = await render(
    <SequenceInspector
      candidate={candidate}
      events={events}
      focusedEventId={null}
      onFocusEvent={vi.fn()}
      onPlaybackChange={onPlaybackChange}
    />,
  );
  await expect.element(screen.getByText('ML 3.0 · MW 4.0')).toBeVisible();
  await expect
    .element(screen.getByRole('button', { name: 'Play sequence' }))
    .toBeVisible();
  await screen
    .getByRole('button', { name: 'Restart sequence playback' })
    .click();
  await screen
    .getByRole('button', { name: 'Show next sequence event' })
    .click();
  expect(onPlaybackChange).toHaveBeenCalled();
});
