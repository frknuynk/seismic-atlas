import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const now = new Date('2026-10-31T11:00:00.000Z').toISOString();
const event = {
  id: 'AFAD:test-1',
  source: 'AFAD',
  sourceEventId: 'test-1',
  originTime: now,
  latitude: 39,
  longitude: 35,
  depthKm: 8,
  magnitude: 3.2,
  magnitudeType: 'ML',
  place: null,
  revisionCount: 2,
};
const run = {
  id: 'run-1',
  trigger: 'scheduled',
  windowKind: 'incremental',
  windowStart: '2026-10-31T10:50:00.000Z',
  windowEnd: now,
  status: 'succeeded',
  startedAt: '2026-10-31T11:00:00.000Z',
  completedAt: '2026-10-31T11:00:01.000Z',
  durationMs: 1_000,
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
};
const generation = {
  lastSuccessAt: now,
  lastRun: { id: 'run-1', status: 'succeeded' },
};

async function fixtureRoutes(page: Page) {
  await page.route('**/e2e/style.json', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  );
  await page.route('**/api/v1/source-health', (route) =>
    route.fulfill({
      json: {
        AFAD: {
          status: 'ok',
          lastAttemptAt: now,
          lastSuccessAt: now,
          latestEventTime: now,
          consecutiveFailures: 0,
          freshness: { state: 'fresh', checkedAt: now, ageMinutes: 1 },
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
      },
    }),
  );
  await page.route(/\/api\/v1\/events\?.*/, (route) =>
    route.fulfill({
      json: {
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
      },
    }),
  );
  await page.route('**/api/v1/events/AFAD%3Atest-1', (route) =>
    route.fulfill({
      json: {
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
            magnitude: 3.1,
            magnitudeType: 'ML',
            place: null,
          },
          {
            revisionNo: 2,
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
      },
    }),
  );
  await page.route('**/data/faults/**', (route) => route.abort());
  await page.route('https://tiles.mapterhorn.com/**', (route) => route.abort());
}

test.beforeEach(async ({ page }) => {
  await fixtureRoutes(page);
});

test('@smoke loads the AFAD journey and event detail', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByText('Location not reported by AFAD').first(),
  ).toBeVisible();
  await page.getByText('Location not reported by AFAD').first().click();
  await expect(page.getByText('Initial observed solution')).toBeVisible();
  await expect(page.getByText('Revision 1')).toBeVisible();
  await expect(page.getByText(/11:00:00 UTC/).first()).toBeVisible();
});

test('desktop controls expose names and serious accessibility issues are absent', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Share current atlas view' }),
  ).toBeVisible();
  await expect(
    page.getByRole('slider', { name: 'Minimum earthquake magnitude' }),
  ).toHaveCount(1);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(
    scan.violations.filter((item) =>
      ['serious', 'critical'].includes(item.impact ?? ''),
    ),
  ).toEqual([]);
});

test('mobile exposes Status and 44px timeline targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Open data status' }),
  ).toContainText('Status');
  const timelineButtons = page.locator(
    '[aria-label^="Earthquakes grouped"] button',
  );
  await expect(timelineButtons.first()).toBeVisible();
  const boxes = await timelineButtons.evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect()),
  );
  expect(boxes.every((box) => box.width >= 44 && box.height >= 44)).toBe(true);
});

test('WebGL-disabled fallback preserves catalog controls', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
    ) {
      return null;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/');
  await expect(page.getByText(/Interactive map unavailable/)).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Search earthquakes in the current map view',
    }),
  ).toBeVisible();
});
