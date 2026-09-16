'use client';

import { Activity, AlertTriangle, LocateFixed } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  buildSequenceInspector,
  cumulativePlotObservations,
  magnitudePlotObservations,
} from '@/lib/science/sequence-inspector';
import type { SeismicSequenceCandidate } from '@/lib/science/seismic-sequences';
import { cn } from '@/lib/utils';
import type { CatalogEvent } from '@/shared/schemas';

const PAGE_SIZE = 50;
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});
const axisTimeFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});
const magnitudeChartConfig = {
  magnitude: { label: 'Magnitude', color: 'var(--chart-1)' },
} satisfies ChartConfig;
const countChartConfig = {
  cumulativeCount: { label: 'Events', color: 'var(--chart-2)' },
} satisfies ChartConfig;

type SequenceInspectorProps = {
  candidate: SeismicSequenceCandidate;
  events: CatalogEvent[];
  focusedEventId: string | null;
  onFocusEvent: (eventId: string) => void;
};

export function SequenceInspector({
  candidate,
  events,
  focusedEventId,
  onFocusEvent,
}: SequenceInspectorProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const data = useMemo(
    () => buildSequenceInspector(candidate, events),
    [candidate, events],
  );

  if (!data.complete) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-5 text-center">
        <div className="max-w-lg rounded-lg border border-amber-300/25 bg-amber-300/[0.06] p-5">
          <AlertTriangle
            className="mx-auto size-5 text-amber-300"
            aria-hidden="true"
          />
          <h3 className="mt-2 font-medium">Sequence data changed</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {data.missingEventIds.length} candidate event(s) are no longer in
            this complete catalog selection. Return to candidates to inspect a
            current sequence; partial charts are not shown.
          </p>
        </div>
      </div>
    );
  }

  const magnitudePlot = magnitudePlotObservations(data.magnitudeObservations);
  const cumulativePlot = cumulativePlotObservations(data.observations);
  const timeDomain: [number, number] = [
    data.observations[0]!.timeMs - 60_000,
    data.observations.at(-1)!.timeMs + 60_000,
  ];

  return (
    <ScrollArea className="atlas-scroll-area min-h-0 flex-1">
      <div className="space-y-3 p-3 md:p-4">
        <div className="rounded-lg border border-primary/25 bg-primary/[0.04] p-3 md:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-primary">
                <Activity className="size-4" aria-hidden="true" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.15em]">
                  Observed sequence candidate
                </span>
              </div>
              <h3 className="mt-1 text-lg font-semibold">
                {candidate.representativePlace ?? 'Unnamed location'}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {dateTimeFormat.format(new Date(candidate.startTime))} –{' '}
                {dateTimeFormat.format(new Date(candidate.endTime))} · Türkiye
                time
              </p>
            </div>
            <Badge variant="outline">{candidate.eventCount} events</Badge>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-primary/15 pt-3 text-xs">
            <Metric
              label="Maximum"
              value={
                candidate.maximumMagnitude === null
                  ? '—'
                  : `M ${candidate.maximumMagnitude.toFixed(1)}`
              }
            />
            <Metric
              label="Span"
              value={formatDuration(candidate.durationHours)}
            />
            <Metric
              label="Radius"
              value={`${candidate.spatialRadiusKm.toFixed(1)} km`}
            />
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <section
            aria-labelledby="sequence-magnitude-title"
            className="min-w-0 rounded-lg border bg-card/55 p-3"
          >
            <div className="mb-2 flex flex-wrap items-start justify-between gap-1">
              <h3 id="sequence-magnitude-title" className="text-sm font-medium">
                Magnitude through time
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {data.magnitudeObservations.length}/{data.observations.length}{' '}
                reported
              </span>
            </div>
            {magnitudePlot.length === 0 ? (
              <p className="grid h-40 place-items-center text-xs text-muted-foreground">
                No member has a reported magnitude.
              </p>
            ) : (
              <ChartContainer
                config={magnitudeChartConfig}
                className="h-40 w-full aspect-auto"
                aria-label="Magnitude of each reported sequence event over time"
              >
                <ScatterChart
                  accessibilityLayer
                  margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="timeMs"
                    domain={timeDomain}
                    tickFormatter={(value) =>
                      axisTimeFormat.format(new Date(Number(value)))
                    }
                    tickCount={3}
                    minTickGap={14}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="number"
                    dataKey="magnitude"
                    domain={['auto', 'auto']}
                    width={36}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Scatter
                    name="Magnitude"
                    data={magnitudePlot.map(({ event, timeMs }) => ({
                      timeMs,
                      magnitude: event.magnitude,
                    }))}
                    fill="var(--color-magnitude)"
                  />
                </ScatterChart>
              </ChartContainer>
            )}
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {data.missingMagnitudeCount > 0
                ? `${data.missingMagnitudeCount} event(s) without reported magnitude are omitted from this plot. `
                : ''}
              {magnitudePlot.length < data.magnitudeObservations.length
                ? `Showing ${magnitudePlot.length} of ${data.magnitudeObservations.length} exact observations; interval extremes retained.`
                : 'Each dot is a reported event; no trend is inferred.'}
            </p>
          </section>

          <section
            aria-labelledby="sequence-cumulative-title"
            className="min-w-0 rounded-lg border bg-card/55 p-3"
          >
            <div className="mb-2 flex flex-wrap items-start justify-between gap-1">
              <h3
                id="sequence-cumulative-title"
                className="text-sm font-medium"
              >
                Cumulative events
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {data.observations.length} total
              </span>
            </div>
            <ChartContainer
              config={countChartConfig}
              className="h-40 w-full aspect-auto"
              aria-label="Cumulative sequence event count over time"
            >
              <LineChart
                data={cumulativePlot}
                accessibilityLayer
                margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="timeMs"
                  domain={timeDomain}
                  tickFormatter={(value) =>
                    axisTimeFormat.format(new Date(Number(value)))
                  }
                  tickCount={3}
                  minTickGap={14}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  width={36}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Line
                  type="stepAfter"
                  dataKey="cumulativeCount"
                  stroke="var(--color-cumulativeCount)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {cumulativePlot.length < data.observations.length
                ? `Showing ${cumulativePlot.length} exact steps; the final total is preserved.`
                : 'One step per observed event. This is not a forecast.'}
            </p>
          </section>
        </div>

        <section
          aria-labelledby="sequence-events-title"
          className="rounded-lg border bg-card/55 p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 id="sequence-events-title" className="text-sm font-medium">
                Events in chronological order
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Select a row to focus its epicentre on the map. Times are
                Türkiye local time.
              </p>
            </div>
            <Badge variant="secondary">
              {data.observations.length} records
            </Badge>
          </div>
          <ol className="mt-3 grid gap-1.5 md:grid-cols-2">
            {data.observations
              .slice(0, visibleCount)
              .map(({ event, cumulativeCount }) => {
                const focused = focusedEventId === event.id;
                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      aria-pressed={focused}
                      aria-label={`Focus event ${cumulativeCount} on map: ${event.place ?? 'Unknown location'}, magnitude ${event.magnitude?.toFixed(1) ?? 'not reported'}, ${dateTimeFormat.format(new Date(event.originTime))}`}
                      onClick={() => onFocusEvent(event.id)}
                      className={cn(
                        'flex min-h-14 w-full items-center gap-2 rounded-md border bg-background/45 p-2 text-left transition hover:border-primary/50 hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        focused && 'border-primary/70 bg-primary/[0.08]',
                      )}
                    >
                      <span className="w-7 shrink-0 text-center font-mono text-xs text-muted-foreground">
                        {cumulativeCount}
                      </span>
                      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 font-mono text-xs font-semibold text-primary">
                        {event.magnitude?.toFixed(1) ?? '—'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {event.place ?? 'Unknown location'}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {dateTimeFormat.format(new Date(event.originTime))} ·{' '}
                          {event.depthKm === null
                            ? 'depth unknown'
                            : `${event.depthKm.toFixed(1)} km deep`}
                        </span>
                      </span>
                      <LocateFixed
                        className={cn(
                          'size-4 shrink-0 text-muted-foreground',
                          focused && 'text-primary',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                );
              })}
          </ol>
          {visibleCount < data.observations.length && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              Show next{' '}
              {Math.min(PAGE_SIZE, data.observations.length - visibleCount)}{' '}
              events
            </Button>
          )}
        </section>

        <p className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-xs leading-5 text-muted-foreground">
          Proximity-based grouping describes the selected catalog only. It does
          not classify mainshocks or aftershocks, attribute fault causation,
          estimate hazard, or predict future earthquakes.
        </p>
      </div>
    </ScrollArea>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm font-medium tabular-nums">
        {value}
      </p>
    </div>
  );
}

function formatDuration(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
