import type { CatalogEvent } from '@/shared/schemas';
import type { TimeRangeHours, TimelineWindow } from '@/shared/atlas-state';

const HOUR_MS = 60 * 60 * 1_000;

export type TimelineBucket = TimelineWindow & {
  count: number;
  maxMagnitude: number | null;
};

export function timelineBucketHours(rangeHours: TimeRangeHours) {
  if (rangeHours <= 24) return 1;
  if (rangeHours <= 72) return 3;
  return 6;
}

export function eventInTimelineWindow(
  event: Pick<CatalogEvent, 'originTime'>,
  window: TimelineWindow,
) {
  const originMs = Date.parse(event.originTime);
  return originMs >= window.startMs && originMs < window.endMs;
}

export function buildTimelineBuckets(
  events: Pick<CatalogEvent, 'originTime' | 'magnitude'>[],
  rangeHours: TimeRangeHours,
  nowMs: number,
) {
  const bucketMs = timelineBucketHours(rangeHours) * HOUR_MS;
  const endMs = Math.ceil(nowMs / bucketMs) * bucketMs;
  const startMs = endMs - rangeHours * HOUR_MS;
  const buckets: TimelineBucket[] = Array.from(
    { length: rangeHours / timelineBucketHours(rangeHours) },
    (_, index) => ({
      startMs: startMs + index * bucketMs,
      endMs: startMs + (index + 1) * bucketMs,
      count: 0,
      maxMagnitude: null,
    }),
  );

  for (const event of events) {
    const originMs = Date.parse(event.originTime);
    if (originMs < startMs || originMs >= endMs) continue;
    const index = Math.floor((originMs - startMs) / bucketMs);
    const bucket = buckets[index];
    bucket.count += 1;
    if (event.magnitude !== null) {
      bucket.maxMagnitude = Math.max(
        bucket.maxMagnitude ?? Number.NEGATIVE_INFINITY,
        event.magnitude,
      );
    }
  }

  return buckets;
}
