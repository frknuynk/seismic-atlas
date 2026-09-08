'use client';

import {
  AlertTriangle,
  Braces,
  Download,
  FileJson2,
  FlaskConical,
  LoaderCircle,
  ScanSearch,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
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
import { useCatalogAnalysis } from '@/hooks/use-catalog-analysis';
import {
  analysisManifest,
  catalogCsv,
  catalogGeoJson,
} from '@/lib/export/catalog-export';
import type {
  AtlasFilters,
  MapBounds,
  TimelineWindow,
} from '@/shared/atlas-state';
import type { CatalogEvent } from '@/shared/schemas';

const countChartConfig = {
  count: { label: 'Events', color: 'var(--primary)' },
} satisfies ChartConfig;

const cumulativeChartConfig = {
  count: { label: 'Cumulative events', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type CatalogLabProps = {
  events: CatalogEvent[];
  filters: AtlasFilters;
  bounds: MapBounds | null;
  timelineWindow: TimelineWindow | null;
};

export function CatalogLab({
  events,
  filters,
  bounds,
  timelineWindow,
}: CatalogLabProps) {
  const state = useCatalogAnalysis(events);
  const analysis = state.analysis;
  const range =
    analysis?.firstEventTime && analysis.lastEventTime
      ? `${dateTimeFormat.format(new Date(analysis.firstEventTime))} – ${dateTimeFormat.format(new Date(analysis.lastEventTime))}`
      : 'No catalog coverage';
  const exportContext = { filters, bounds, timelineWindow };
  const fileStem = `seismic-atlas-afad-${new Date().toISOString().slice(0, 10)}`;

  return (
    <section
      aria-labelledby="catalog-lab-title"
      className="absolute inset-x-3 bottom-3 z-10 flex max-h-[72vh] min-h-72 flex-col overflow-hidden rounded-xl border border-primary/25 bg-background/95 shadow-[0_24px_80px_rgb(0_0_0/48%)] backdrop-blur-xl md:inset-x-4 md:h-[46vh] md:min-h-80"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-primary/15 bg-primary/[0.04] px-3 py-2.5 md:px-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary shadow-[0_0_24px_color-mix(in_oklab,var(--primary)_18%,transparent)]">
          <FlaskConical className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 id="catalog-lab-title" className="font-semibold">
              Catalog Lab
            </h2>
            <Badge variant="outline">Viewport subset</Badge>
            {state.status === 'refreshing' && (
              <Badge variant="secondary" aria-live="polite">
                Updating…
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {range} · AFAD preferred solutions
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              !analysis || events.length === 0 || state.status === 'refreshing'
            }
            onClick={() =>
              downloadFile(`${fileStem}.csv`, catalogCsv(events), 'text/csv')
            }
          >
            <Download className="size-3.5" aria-hidden="true" />
            <span className="hidden lg:inline">CSV</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              !analysis || events.length === 0 || state.status === 'refreshing'
            }
            onClick={() =>
              downloadFile(
                `${fileStem}.geojson`,
                JSON.stringify(catalogGeoJson(events), null, 2),
                'application/geo+json',
              )
            }
          >
            <FileJson2 className="size-3.5" aria-hidden="true" />
            <span className="hidden lg:inline">GeoJSON</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!analysis || state.status === 'refreshing'}
            onClick={() => {
              if (!analysis) return;
              downloadFile(
                `${fileStem}-methods.json`,
                JSON.stringify(
                  analysisManifest(events, analysis, exportContext),
                  null,
                  2,
                ),
                'application/json',
              );
            }}
          >
            <Braces className="size-3.5" aria-hidden="true" />
            <span className="hidden lg:inline">Methods</span>
          </Button>
        </div>
      </div>

      {state.status === 'loading' && (
        <div className="grid min-h-0 flex-1 place-items-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Computing this catalog subset in your browser…
          </div>
        </div>
      )}

      {state.status === 'error' && !analysis && (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-sm text-muted-foreground">
          The browser analysis worker could not process this subset. Map data
          remains unchanged.
        </div>
      )}

      {analysis && (
        <ScrollArea className="atlas-scroll-area min-h-0 flex-1">
          <div className="p-3 md:p-4">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <LabMetric
                label="Events"
                value={analysis.eventCount.toLocaleString()}
              />
              <LabMetric
                label="Maximum"
                value={
                  analysis.maximumMagnitude === null
                    ? '—'
                    : `M ${analysis.maximumMagnitude.toFixed(1)}`
                }
              />
              <LabMetric
                label="Magnitude coverage"
                value={`${analysis.magnitudeCoveragePercent}%`}
              />
              <LabMetric
                label="Depth coverage"
                value={`${analysis.depthCoveragePercent}%`}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <ScanSearch
                className="size-3.5 text-primary"
                aria-hidden="true"
              />
              <span>Magnitude types:</span>
              {analysis.magnitudeTypes.length === 0 ? (
                <span>none reported</span>
              ) : (
                analysis.magnitudeTypes.map((item) => (
                  <Badge key={item.type} variant="secondary">
                    {item.type} · {item.count.toLocaleString()}
                  </Badge>
                ))
              )}
            </div>

            {analysis.eventCount === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No events match the current map and timeline selection. Expand
                the viewport or clear a filter to analyze a catalog subset.
              </div>
            ) : (
              <div className="mt-3 grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
                <LabChart title="Events through time" detail="Adaptive bins">
                  <ChartContainer
                    config={countChartConfig}
                    className="h-36 w-full aspect-auto"
                  >
                    <BarChart
                      accessibilityLayer
                      data={analysis.timeHistogram.map((bin) => ({
                        label: dateTimeFormat.format(new Date(bin.startMs)),
                        count: bin.count,
                      }))}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="label" hide />
                      <YAxis
                        allowDecimals={false}
                        width={28}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="count"
                        fill="var(--color-count)"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                </LabChart>

                <LabChart title="Magnitude distribution" detail="0.5-unit bins">
                  <ChartContainer
                    config={countChartConfig}
                    className="h-36 w-full aspect-auto"
                  >
                    <BarChart
                      accessibilityLayer
                      data={analysis.magnitudeHistogram}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={18}
                      />
                      <YAxis
                        allowDecimals={false}
                        width={28}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="count"
                        fill="var(--color-count)"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                </LabChart>

                <LabChart title="Depth distribution" detail="Kilometres">
                  <ChartContainer
                    config={countChartConfig}
                    className="h-36 w-full aspect-auto"
                  >
                    <BarChart accessibilityLayer data={analysis.depthHistogram}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        width={28}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="count"
                        fill="var(--color-count)"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                </LabChart>

                <LabChart
                  title="Frequency–magnitude"
                  detail="Cumulative · descriptive"
                >
                  <ChartContainer
                    config={cumulativeChartConfig}
                    className="h-36 w-full aspect-auto"
                  >
                    <LineChart
                      accessibilityLayer
                      data={analysis.frequencyMagnitude}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="magnitude"
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => Number(value).toFixed(1)}
                      />
                      <YAxis
                        allowDecimals={false}
                        width={32}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line
                        dataKey="count"
                        type="stepAfter"
                        stroke="var(--color-count)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ChartContainer>
                </LabChart>
              </div>
            )}

            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-amber-300"
                aria-hidden="true"
              />
              <div>
                {analysis.quality.messages.map((message) => (
                  <p key={message}>{message}</p>
                ))}
                <p>
                  These plots describe the selected catalog; they are not an
                  earthquake forecast or hazard score.
                </p>
              </div>
            </div>
          </div>
        </ScrollArea>
      )}
    </section>
  );
}

function LabMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card/65 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function LabChart({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card/55 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{detail}</span>
      </div>
      {children}
    </section>
  );
}
