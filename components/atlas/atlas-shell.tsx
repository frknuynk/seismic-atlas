'use client';

import {
  Activity,
  Binoculars,
  Check,
  Clock3,
  Database,
  FlaskConical,
  Layers3,
  MapPin,
  RefreshCw,
  Share2,
  SlidersHorizontal,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EventDetailSheet } from '@/components/atlas/event-detail-sheet';
import { EventSearch } from '@/components/atlas/event-search';
import { CatalogLab } from '@/components/atlas/catalog-lab';
import {
  FilterControls,
  LayerControls,
} from '@/components/atlas/explorer-controls';
import { EventTimeline } from '@/components/atlas/event-timeline';
import { MapCanvas } from '@/components/map/map-canvas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useEventDetail } from '@/hooks/use-event-detail';
import { useNearestFault } from '@/hooks/use-nearest-fault';
import { useRecentEvents } from '@/hooks/use-recent-events';
import { eventInTimelineWindow } from '@/lib/timeline';
import { isLegacyOverviewCamera } from '@/lib/map/turkiye-overview';
import type { SourceHealthResponse } from '@/shared/schemas';
import {
  type AtlasFilters,
  type AtlasMode,
  type MapBounds,
  type MapCamera,
  type TimeRangeHours,
  type TimelineWindow,
} from '@/shared/atlas-state';

function formatEventTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(value));
}

function sourceFreshness(value: string | null | undefined) {
  if (!value) return 'Not synchronized';
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(value)) / 60_000),
  );
  if (minutes < 1) return 'Synchronized just now';
  if (minutes < 60) return `Synchronized ${minutes}m ago`;
  return `Synchronized ${Math.round(minutes / 60)}h ago`;
}

function sourceStatusLabel(status: string | null | undefined) {
  if (status === 'ok') return 'AFAD synchronized';
  if (status === 'delayed') return 'AFAD synchronization delayed';
  if (status === 'error') return 'AFAD synchronization failing';
  return 'AFAD awaiting first sync';
}

function sourceStatusColor(status: string | null | undefined) {
  if (status === 'ok') return 'bg-emerald-400';
  if (status === 'delayed') return 'bg-amber-400';
  if (status === 'error') return 'bg-rose-400';
  return 'bg-slate-500';
}

function syncRunSummary(
  run: NonNullable<SourceHealthResponse['AFAD']['lastRun']>,
) {
  if (run.status === 'running') return 'Synchronization is currently running.';
  if (run.status === 'failed') {
    return `Last run failed after ${run.attempts} attempt${run.attempts === 1 ? '' : 's'}${run.errorCode ? ` · ${run.errorCode}` : ''}.`;
  }
  const changed = run.inserted + run.updated;
  const qualityNotes = run.rejected + run.duplicatesDropped;
  const saturationRecovery =
    run.splits > 0
      ? ` · ${run.splits.toLocaleString()} saturation split${run.splits === 1 ? '' : 's'}`
      : '';
  return `${run.accepted.toLocaleString()} accepted · ${changed.toLocaleString()} changed${qualityNotes > 0 ? ` · ${qualityNotes.toLocaleString()} quarantined/duplicate` : ''}${saturationRecovery}.`;
}

function parseNumber(value: string | string[] | undefined) {
  if (value === undefined || Array.isArray(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isTimeRange(value: number): value is TimeRangeHours {
  return value === 24 || value === 72 || value === 168;
}

type InitialSearch = Record<string, string | string[] | undefined>;

function parseInitialState(search: InitialSearch) {
  const range = parseNumber(search.range);
  const minMagnitude = parseNumber(search.minMag);
  const maxDepth = parseNumber(search.maxDepth);
  const longitude = parseNumber(search.lng);
  const latitude = parseNumber(search.lat);
  const zoom = parseNumber(search.z);
  const pitch = parseNumber(search.pitch);
  const bearing = parseNumber(search.bearing);
  const event = typeof search.event === 'string' ? search.event : null;
  const faultOpacity = parseNumber(search.faultOpacity);
  const timelineStart = parseNumber(search.t0);
  const timelineEnd = parseNumber(search.t1);
  const mode: AtlasMode = search.mode === 'lab' ? 'lab' : 'explore';

  const parsedCamera =
    longitude !== null &&
    latitude !== null &&
    zoom !== null &&
    pitch !== null &&
    bearing !== null
      ? { longitude, latitude, zoom, pitch, bearing }
      : null;

  return {
    filters: {
      rangeHours: range !== null && isTimeRange(range) ? range : 168,
      minMagnitude:
        minMagnitude !== null && minMagnitude >= 0 && minMagnitude <= 6
          ? minMagnitude
          : 0,
      maxDepth:
        maxDepth !== null && maxDepth >= 10 && maxDepth <= 300 ? maxDepth : 300,
    } satisfies AtlasFilters,
    event,
    eventsVisible: search.earthquakes !== 'off',
    faultsVisible: search.faults !== 'off',
    faultOpacity:
      faultOpacity === null ? 0.82 : Math.min(1, Math.max(0.2, faultOpacity)),
    timelineWindow:
      timelineStart !== null &&
      timelineEnd !== null &&
      timelineStart < timelineEnd
        ? { startMs: timelineStart, endMs: timelineEnd }
        : null,
    mode,
    camera: isLegacyOverviewCamera(parsedCamera) ? null : parsedCamera,
  };
}

export function AtlasShell({
  initialSearch = {},
}: {
  initialSearch?: InitialSearch;
}) {
  const [initialState] = useState(() => parseInitialState(initialSearch));
  const [filters, setFilters] = useState<AtlasFilters>(initialState.filters);
  const [mode, setMode] = useState<AtlasMode>(initialState.mode);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [camera, setCamera] = useState<MapCamera | null>(initialState.camera);
  const [eventsVisible, setEventsVisible] = useState(
    initialState.eventsVisible,
  );
  const [faultsVisible, setFaultsVisible] = useState(
    initialState.faultsVisible,
  );
  const [faultOpacity, setFaultOpacity] = useState(initialState.faultOpacity);
  const [selectedTimeWindow, setSelectedTimeWindow] =
    useState<TimelineWindow | null>(initialState.timelineWindow);
  const [previewTimeWindow, setPreviewTimeWindow] =
    useState<TimelineWindow | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialState.event,
  );
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'ready'>(
    'idle',
  );
  const { events, health, state, refresh } = useRecentEvents(filters, bounds);
  const { detail, loading: detailLoading } = useEventDetail(selectedEventId);
  const selectedEvents = useMemo(
    () =>
      selectedTimeWindow
        ? events.filter((event) =>
            eventInTimelineWindow(event, selectedTimeWindow),
          )
        : events,
    [events, selectedTimeWindow],
  );
  const mapEvents = useMemo(() => {
    const activeWindow = previewTimeWindow ?? selectedTimeWindow;
    return activeWindow
      ? events.filter((event) => eventInTimelineWindow(event, activeWindow))
      : events;
  }, [events, previewTimeWindow, selectedTimeWindow]);
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );
  const activeEvent = detail ?? selectedEvent;
  const { fault: nearestFault, loading: nearestFaultLoading } =
    useNearestFault(activeEvent);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('range', String(filters.rangeHours));
    url.searchParams.set('minMag', String(filters.minMagnitude));
    url.searchParams.set('maxDepth', String(filters.maxDepth));
    if (selectedEventId) url.searchParams.set('event', selectedEventId);
    if (!eventsVisible) url.searchParams.set('earthquakes', 'off');
    if (!faultsVisible) url.searchParams.set('faults', 'off');
    url.searchParams.set('faultOpacity', faultOpacity.toFixed(2));
    if (mode === 'lab') url.searchParams.set('mode', mode);
    if (selectedTimeWindow) {
      url.searchParams.set('t0', String(selectedTimeWindow.startMs));
      url.searchParams.set('t1', String(selectedTimeWindow.endMs));
    }
    if (camera) {
      url.searchParams.set('lng', camera.longitude.toFixed(4));
      url.searchParams.set('lat', camera.latitude.toFixed(4));
      url.searchParams.set('z', camera.zoom.toFixed(2));
      url.searchParams.set('pitch', camera.pitch.toFixed(1));
      url.searchParams.set('bearing', camera.bearing.toFixed(1));
    }
    window.history.replaceState(null, '', url);
  }, [
    camera,
    eventsVisible,
    faultOpacity,
    faultsVisible,
    filters,
    mode,
    selectedTimeWindow,
    selectedEventId,
  ]);

  function handleFiltersChange(nextFilters: AtlasFilters) {
    if (nextFilters.rangeHours !== filters.rangeHours) {
      setSelectedTimeWindow(null);
      setPreviewTimeWindow(null);
    }
    setFilters(nextFilters);
  }

  function handleSearchSelection(eventId: string) {
    setSelectedTimeWindow(null);
    setPreviewTimeWindow(null);
    setSelectedEventId(eventId);
  }

  const handleBoundsChange = useCallback((nextBounds: MapBounds) => {
    setBounds(nextBounds);
  }, []);
  const handleCameraChange = useCallback(
    (nextCamera: MapCamera, userInitiated: boolean) => {
      if (userInitiated) setCamera(nextCamera);
    },
    [],
  );

  async function shareView() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareState('copied');
    } catch {
      setShareState('ready');
    }
    window.setTimeout(() => setShareState('idle'), 2_000);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-md border border-primary/30 bg-primary/10 text-primary">
            <Activity className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">
              Seismic Atlas
            </h1>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Türkiye seismic workspace
            </p>
          </div>
        </div>

        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as AtlasMode)}
          className="shrink-0"
        >
          <TabsList aria-label="Atlas mode" className="bg-muted/70">
            <TabsTrigger value="explore" aria-label="Explore mode">
              <Binoculars className="size-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">Explore</span>
            </TabsTrigger>
            <TabsTrigger value="lab" aria-label="Catalog Lab mode">
              <FlaskConical className="size-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">Catalog Lab</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <EventSearch events={events} onSelectEvent={handleSearchSelection} />

        <Button type="button" variant="outline" size="sm" onClick={shareView}>
          {shareState === 'copied' ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Share2 className="size-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">
            {shareState === 'copied'
              ? 'Copied'
              : shareState === 'ready'
                ? 'URL ready'
                : 'Share view'}
          </span>
        </Button>
      </header>

      <section className="flex min-h-0 flex-1">
        <aside className="hidden w-80 shrink-0 flex-col border-r bg-sidebar md:flex">
          <div className="border-b p-4">
            <FilterControls
              filters={filters}
              resultCount={selectedEvents.length}
              onChange={handleFiltersChange}
            />
          </div>

          <ScrollArea className="atlas-scroll-area min-h-0 flex-1">
            <div className="space-y-5 p-4 pr-5">
              <LayerControls
                controlId="earthquake-layer-desktop"
                eventsVisible={eventsVisible}
                faultsVisible={faultsVisible}
                faultOpacity={faultOpacity}
                eventCount={selectedEvents.length}
                onEventsVisibleChange={setEventsVisible}
                onFaultsVisibleChange={setFaultsVisible}
                onFaultOpacityChange={setFaultOpacity}
              />

              <section aria-labelledby="recent-title">
                <div className="mb-2 flex items-center justify-between">
                  <h2
                    id="recent-title"
                    className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    Latest in view
                  </h2>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={refresh}
                    aria-label="Refresh stored earthquake catalog"
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {selectedEvents.slice(0, 12).map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => setSelectedEventId(event.id)}
                      className="flex w-full items-center gap-3 rounded-md border bg-card/45 p-2.5 text-left transition hover:border-primary/40 hover:bg-card"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-cyan-200/30 bg-cyan-300/10 font-mono text-sm font-semibold text-cyan-200">
                        {event.magnitude?.toFixed(1) ?? '—'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {event.place ?? 'Unknown location'}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {formatEventTime(event.originTime)} ·{' '}
                          {event.depthKm === null
                            ? 'depth unknown'
                            : `${event.depthKm.toFixed(1)} km deep`}
                        </span>
                      </span>
                    </button>
                  ))}
                  {state === 'ready' && selectedEvents.length === 0 && (
                    <p className="rounded-md border border-dashed p-3 text-xs leading-5 text-muted-foreground">
                      No stored events match this map view and filter
                      combination.
                    </p>
                  )}
                </div>
              </section>

              <section aria-labelledby="source-title">
                <h2
                  id="source-title"
                  className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  <Database className="size-4" aria-hidden="true" />
                  Source health
                </h2>
                <div className="rounded-md border bg-card/55 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className={`size-2 rounded-full ${sourceStatusColor(health?.status)}`}
                    />
                    {sourceStatusLabel(health?.status)}
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                    {sourceFreshness(health?.lastSuccessAt)}. Stored results
                    remain available during upstream interruptions.
                  </p>
                  {health?.lastRun && (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {syncRunSummary(health.lastRun)}
                    </p>
                  )}
                </div>
              </section>
            </div>
          </ScrollArea>
        </aside>

        <div className="relative min-w-0 flex-1">
          <MapCanvas
            events={mapEvents}
            eventsVisible={eventsVisible}
            faultsVisible={faultsVisible}
            faultOpacity={faultOpacity}
            initialCamera={initialState.camera}
            selectedEventId={selectedEventId}
            nearestFaultId={nearestFault?.id ?? null}
            onSelectEvent={setSelectedEventId}
            onViewportChange={handleBoundsChange}
            onCameraChange={handleCameraChange}
            onResetView={() => setCamera(null)}
          />

          <div className="absolute left-3 top-3 flex gap-2 md:hidden">
            <Sheet>
              <SheetTrigger render={<Button size="sm" variant="secondary" />}>
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                Filters
              </SheetTrigger>
              <SheetContent
                side="left"
                className="atlas-native-scrollbar w-[88vw] overflow-y-auto"
              >
                <SheetHeader>
                  <SheetTitle>Filter earthquakes</SheetTitle>
                  <SheetDescription>
                    Results update from the stored AFAD catalog.
                  </SheetDescription>
                </SheetHeader>
                <div className="p-4">
                  <FilterControls
                    filters={filters}
                    resultCount={selectedEvents.length}
                    onChange={handleFiltersChange}
                  />
                </div>
              </SheetContent>
            </Sheet>

            <Sheet>
              <SheetTrigger render={<Button size="sm" variant="secondary" />}>
                <Layers3 className="size-4" aria-hidden="true" />
                Layers
              </SheetTrigger>
              <SheetContent
                side="left"
                className="atlas-native-scrollbar w-[88vw] overflow-y-auto"
              >
                <SheetHeader>
                  <SheetTitle>Map layers</SheetTitle>
                  <SheetDescription>
                    Control what is visible over the terrain map.
                  </SheetDescription>
                </SheetHeader>
                <div className="p-4">
                  <LayerControls
                    controlId="earthquake-layer-mobile"
                    eventsVisible={eventsVisible}
                    faultsVisible={faultsVisible}
                    faultOpacity={faultOpacity}
                    eventCount={selectedEvents.length}
                    onEventsVisibleChange={setEventsVisible}
                    onFaultsVisibleChange={setFaultsVisible}
                    onFaultOpacityChange={setFaultOpacity}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {mode === 'lab' ? (
            <CatalogLab
              events={selectedEvents}
              filters={filters}
              bounds={bounds}
              timelineWindow={selectedTimeWindow}
            />
          ) : (
            <section className="absolute inset-x-3 bottom-3 rounded-lg border bg-background/92 p-3 shadow-2xl backdrop-blur md:left-4 md:right-auto md:w-[430px] md:p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                  <MapPin className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">
                      Earthquakes in this view
                    </h2>
                    <Badge variant="outline">
                      {selectedEvents.length} events
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    {state === 'error'
                      ? 'The stored catalog could not be loaded. The terrain map remains available.'
                      : selectedTimeWindow
                        ? 'A timeline bucket is filtering the map and list. Clear it to restore the full range.'
                        : 'Move the map or adjust filters to refine the list. Select a timeline bucket or map marker.'}
                  </p>
                  <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Clock3 className="size-3.5" aria-hidden="true" />{' '}
                      {sourceFreshness(health?.lastSuccessAt)}
                    </span>
                    <span className="font-mono">
                      M {filters.minMagnitude.toFixed(1)}+
                    </span>
                  </div>
                  <EventTimeline
                    events={events}
                    rangeHours={filters.rangeHours}
                    selectedWindow={selectedTimeWindow}
                    onSelectedWindowChange={setSelectedTimeWindow}
                    onPreviewWindowChange={setPreviewTimeWindow}
                  />
                </div>
              </div>
            </section>
          )}
        </div>
      </section>

      <EventDetailSheet
        eventId={selectedEventId}
        summary={selectedEvent}
        detail={detail}
        loading={detailLoading}
        nearbyFault={nearestFault}
        nearbyFaultLoading={nearestFaultLoading}
        onOpenChange={(open) => {
          if (!open) setSelectedEventId(null);
        }}
      />
    </main>
  );
}
