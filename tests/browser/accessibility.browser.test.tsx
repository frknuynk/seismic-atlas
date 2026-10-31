import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { EventTimeline } from '@/components/atlas/event-timeline';
import { Slider } from '@/components/ui/slider';
import type { CatalogEvent } from '@/shared/schemas';

test('places the accessible name on the focusable slider thumb', async () => {
  const screen = await render(
    <Slider
      min={0}
      max={10}
      value={[4]}
      thumbAriaLabel="Minimum magnitude"
      onValueChange={() => {}}
    />,
  );

  await expect
    .element(screen.getByRole('slider', { name: 'Minimum magnitude' }))
    .toHaveAttribute('aria-valuenow', '4');
});

test('renders mixed magnitude timeline buckets with 44px targets', async () => {
  const now = Date.now();
  const events = [
    {
      id: 'AFAD:1',
      source: 'AFAD',
      sourceEventId: '1',
      originTime: new Date(now - 2 * 60_000).toISOString(),
      latitude: 39,
      longitude: 35,
      depthKm: 8,
      magnitude: 2.4,
      magnitudeType: 'ML',
      place: 'Türkiye',
      revisionCount: 1,
    },
    {
      id: 'AFAD:2',
      source: 'AFAD',
      sourceEventId: '2',
      originTime: new Date(now - 60_000).toISOString(),
      latitude: 39,
      longitude: 35,
      depthKm: 8,
      magnitude: 3.1,
      magnitudeType: 'MW',
      place: 'Türkiye',
      revisionCount: 1,
    },
  ] satisfies CatalogEvent[];

  await render(
    <EventTimeline
      events={events}
      rangeHours={24}
      selectedWindow={null}
      onSelectedWindowChange={() => {}}
      onPreviewWindowChange={() => {}}
    />,
  );

  const mixed = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find(
    (button) =>
      button.getAttribute('aria-label')?.includes('maximum by type ML') &&
      button.getAttribute('aria-label')?.includes('MW'),
  );
  expect(mixed).toBeDefined();
  expect(mixed!.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
  expect(mixed!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});
