import { describe, expect, it } from 'vitest';
import {
  buildTimelineBuckets,
  eventInTimelineWindow,
  timelineBucketHours,
} from '@/lib/timeline';
import type { CatalogEvent } from '@/shared/schemas';

function event(originTime: string, magnitude: number | null) {
  return { originTime, magnitude } as CatalogEvent;
}

describe('earthquake timeline', () => {
  it('uses readable bucket sizes for every supported range', () => {
    expect(timelineBucketHours(24)).toBe(1);
    expect(timelineBucketHours(72)).toBe(3);
    expect(timelineBucketHours(168)).toBe(6);
  });

  it('groups events and retains the maximum magnitude', () => {
    const now = Date.parse('2026-09-06T12:00:00.000Z');
    const buckets = buildTimelineBuckets(
      [
        event('2026-09-06T10:10:00.000Z', 2.1),
        event('2026-09-06T10:40:00.000Z', 3.4),
        event('2026-09-06T11:20:00.000Z', 1.8),
      ],
      24,
      now,
    );

    expect(buckets).toHaveLength(24);
    expect(buckets.at(-2)).toMatchObject({ count: 2, maxMagnitude: 3.4 });
    expect(buckets.at(-1)).toMatchObject({ count: 1, maxMagnitude: 1.8 });
  });

  it('uses a half-open interval when filtering events', () => {
    const window = { startMs: 100, endMs: 200 };
    expect(
      eventInTimelineWindow(event(new Date(100).toISOString(), 1), window),
    ).toBe(true);
    expect(
      eventInTimelineWindow(event(new Date(200).toISOString(), 1), window),
    ).toBe(false);
  });
});
