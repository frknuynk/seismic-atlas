'use client';

import { BarChart3, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  buildTimelineBuckets,
  timelineBucketHours,
  type TimelineBucket,
} from '@/lib/timeline';
import type { TimeRangeHours, TimelineWindow } from '@/shared/atlas-state';
import type { CatalogEvent } from '@/shared/schemas';

function sameWindow(first: TimelineWindow | null, second: TimelineWindow) {
  return first?.startMs === second.startMs && first.endMs === second.endMs;
}

function barColor(maxMagnitudes: TimelineBucket['maxMagnitudes']) {
  if (maxMagnitudes.length !== 1) return 'bg-violet-300';
  const maximum = maxMagnitudes[0]!.value;
  if (maximum < 3) return 'bg-cyan-300';
  if (maximum < 4) return 'bg-yellow-400';
  if (maximum < 5) return 'bg-orange-400';
  return 'bg-rose-400';
}

function shortTime(value: number, rangeHours: TimeRangeHours) {
  return new Intl.DateTimeFormat('en-GB', {
    day: rangeHours === 24 ? undefined : '2-digit',
    month: rangeHours === 24 ? undefined : 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(value));
}

function bucketLabel(bucket: TimelineBucket, rangeHours: TimeRangeHours) {
  const magnitude =
    bucket.maxMagnitudes.length === 0
      ? ''
      : `, maximum by type ${bucket.maxMagnitudes
          .map((item) => `${item.type} ${item.value.toFixed(1)}`)
          .join(', ')}`;
  return `${shortTime(bucket.startMs, rangeHours)} to ${shortTime(
    bucket.endMs,
    rangeHours,
  )}, ${bucket.count} earthquake${bucket.count === 1 ? '' : 's'}${magnitude}`;
}

type EventTimelineProps = {
  events: CatalogEvent[];
  rangeHours: TimeRangeHours;
  selectedWindow: TimelineWindow | null;
  onSelectedWindowChange: (window: TimelineWindow | null) => void;
  onPreviewWindowChange: (window: TimelineWindow | null) => void;
};

export function EventTimeline({
  events,
  rangeHours,
  selectedWindow,
  onSelectedWindowChange,
  onPreviewWindowChange,
}: EventTimelineProps) {
  const [referenceTime] = useState(Date.now);
  const buckets = useMemo(
    () => buildTimelineBuckets(events, rangeHours, referenceTime),
    [events, rangeHours, referenceTime],
  );
  const maximumCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const bucketHours = timelineBucketHours(rangeHours);

  return (
    <section aria-labelledby="timeline-title" className="mt-3 border-t pt-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-4 text-primary" aria-hidden="true" />
        <h3
          id="timeline-title"
          className="text-xs font-semibold uppercase tracking-[0.12em]"
        >
          Event timeline
        </h3>
        <span className="text-xs text-muted-foreground">
          {bucketHours === 1 ? 'Hourly' : `${bucketHours}-hour`} buckets
        </span>
        {selectedWindow && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="ml-auto h-6 px-2 text-xs"
            onClick={() => onSelectedWindowChange(null)}
          >
            <X className="size-3" aria-hidden="true" />
            Clear
          </Button>
        )}
      </div>

      <div className="atlas-native-scrollbar mt-2 overflow-x-auto pb-2 md:overflow-visible md:pb-0">
        <div
          className="flex h-16 min-w-max items-end gap-1 md:min-w-0 md:gap-0.5"
          aria-label={`Earthquakes grouped into ${bucketHours}-hour time buckets`}
        >
          {buckets.map((bucket) => {
          const selected = sameWindow(selectedWindow, bucket);
          const height = Math.max(8, (bucket.count / maximumCount) * 100);
          return (
            <button
              key={bucket.startMs}
              type="button"
              aria-label={bucketLabel(bucket, rangeHours)}
              aria-pressed={selected}
              title={bucketLabel(bucket, rangeHours)}
              onMouseEnter={() => onPreviewWindowChange(bucket)}
              onMouseLeave={() => onPreviewWindowChange(null)}
              onFocus={() => onPreviewWindowChange(bucket)}
              onBlur={() => onPreviewWindowChange(null)}
              onClick={() => onSelectedWindowChange(selected ? null : bucket)}
              className="group flex h-full min-w-11 items-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-w-0 md:flex-1"
            >
              <span
                aria-hidden="true"
                style={{ height: `${height}%` }}
                className={`block w-full rounded-sm opacity-65 transition group-hover:opacity-100 group-aria-pressed:ring-2 group-aria-pressed:ring-white group-aria-pressed:opacity-100 ${barColor(
                  bucket.maxMagnitudes,
                )}`}
              />
            </button>
          );
          })}
        </div>
      </div>

      {buckets.length > 0 && (
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{shortTime(buckets[0].startMs, rangeHours)}</span>
          <span>Türkiye time</span>
          <span>{shortTime(buckets.at(-1)!.endMs, rangeHours)}</span>
        </div>
      )}
    </section>
  );
}
