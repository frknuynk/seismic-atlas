import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { analyzeCatalog } from '@/lib/science/catalog-analysis';

vi.mock('@/components/map/map-canvas', () => ({
  MapCanvas: () => <div aria-label="Deterministic map fixture" />,
}));

import { AtlasShell } from '@/components/atlas/atlas-shell';

test('runs the primary Atlas journey with deterministic API fixtures', async () => {
  await page.viewport(1280, 800);
  const now = new Date().toISOString();
  const event = {
    id: 'AFAD:shell',
    source: 'AFAD',
    sourceEventId: 'shell',
    originTime: now,
    latitude: 39,
    longitude: 35,
    depthKm: 8,
    magnitude: 3.2,
    magnitudeType: 'ML',
    place: null,
    revisionCount: 1,
  } as const;
  const run = {
    id: 'run-shell',
    trigger: 'scheduled',
    windowKind: 'incremental',
    windowStart: now,
    windowEnd: now,
    status: 'succeeded',
    startedAt: now,
    completedAt: now,
    durationMs: 1,
    attempts: 1,
    splits: 0,
    writeBatches: 1,
    fetched: 1,
    accepted: 1,
    rejected: 0,
    duplicatesDropped: 0,
    inserted: 1,
    updated: 0,
    unchanged: 0,
    errorCode: null,
  } as const;
  const generation = {
    lastSuccessAt: now,
    lastRun: { id: run.id, status: run.status },
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes('/api/v1/source-health')) {
      return Response.json({
        AFAD: {
          status: 'ok',
          lastAttemptAt: now,
          lastSuccessAt: now,
          latestEventTime: now,
          consecutiveFailures: 0,
          freshness: { state: 'fresh', checkedAt: now, ageMinutes: 0 },
          schedule: {
            cadenceMinutes: 5,
            delayedAfterMinutes: 15,
            staleAfterMinutes: 60,
            nextScheduledAt: now,
          },
          scheduler: {
            state: 'healthy',
            checkedAt: now,
            overdueAfterMinutes: 15,
            lastScheduledAt: now,
            lastScheduledCompletedAt: now,
            lastScheduledStatus: 'succeeded',
          },
          requestControl: { status: 'closed', retryAt: null, errorCode: null },
          lastRun: run,
          lastScheduledRun: run,
        },
      });
    }
    if (url.includes('/api/v1/events?')) {
      return Response.json({
        meta: {
          count: 1,
          total: 1,
          returned: 1,
          hasMore: false,
          truncated: false,
          nextCursor: null,
          generation,
          source: ['AFAD'],
          freshness: { AFAD: now },
        },
        events: [event],
      });
    }
    if (url.includes('/api/v1/data-quality')) {
      return Response.json({
        generatedAt: now,
        source: 'AFAD',
        status: 'warning',
        coverage: { firstEventTime: now, lastEventTime: now },
        counts: {
          total: 1,
          revisedEvents: 0,
          missingMagnitude: 0,
          missingDepth: 0,
          missingMagnitudeType: 0,
          missingPlace: 1,
          invalidCoordinates: 0,
          negativeDepth: 0,
          extremeDepth: 0,
          unusualMagnitude: 0,
          duplicateSourceIds: 0,
        },
        coveragePercent: {
          magnitude: 100,
          depth: 100,
          magnitudeType: 100,
          place: 0,
        },
        ingestionLast7Days: {
          runs: 1,
          fetched: 1,
          accepted: 1,
          rejected: 0,
          duplicatesDropped: 0,
        },
        checks: [
          {
            code: 'field-coverage',
            status: 'warning',
            affected: 1,
            message: 'Place coverage requires review.',
          },
        ],
      });
    }
    if (url.includes('/api/v1/events/AFAD%3Ashell')) {
      return Response.json({
        ...event,
        sourceStatus: 'reviewed',
        sourceUpdatedAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
        revisions: [
          {
            revisionNo: 1,
            observedAt: now,
            sourceUpdatedAt: now,
            originTime: now,
            latitude: 39,
            longitude: 35,
            depthKm: 8,
            magnitude: 3.2,
            magnitudeType: 'ML',
            place: null,
          },
        ],
      });
    }
    if (url.includes('/data/faults/')) {
      return Response.json({ type: 'FeatureCollection', features: [] });
    }
    return new Response('Not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetcher);
  class AnalysisWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(message: { requestId: string; events: (typeof event)[] }) {
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            requestId: message.requestId,
            analysis: analyzeCatalog(message.events),
          },
        } as MessageEvent),
      );
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', AnalysisWorker);

  const screen = await render(<AtlasShell initialSearch={{ range: '24' }} />);
  await expect
    .element(screen.getByText('Location not reported by AFAD').first())
    .toBeVisible();
  await expect.element(screen.getByText('AFAD synchronized')).toBeVisible();
  await expect
    .element(screen.getByText(/not an early-warning, hazard-assessment/))
    .toBeVisible();
  await expect
    .element(
      screen.getByRole('slider', { name: 'Minimum earthquake magnitude' }),
    )
    .toHaveAttribute('aria-valuenow', '0');

  await screen
    .getByRole('button', {
      name: 'Search earthquakes in the current map view',
    })
    .click();
  const searchResult = screen.getByText(/AFAD shell/);
  await expect.element(searchResult).toBeVisible();
  await searchResult.click();
  await expect
    .element(screen.getByText('Initial observed solution'))
    .toBeVisible();
  await screen.getByRole('button', { name: 'Close' }).click();
  await screen.getByRole('tab', { name: 'Catalog Lab mode' }).click();
  await expect.element(screen.getByText('Catalog integrity')).toBeVisible();
  await screen.getByText('Review affected quality checks').click();
  await expect.element(screen.getByText(/field-coverage/)).toBeVisible();
  expect(fetcher).toHaveBeenCalled();
});
