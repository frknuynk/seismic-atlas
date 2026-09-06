'use client';

import { LocateFixed, Mountain, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import {
  eventFocusForViewport,
  isLegacyOverviewCamera,
  TURKIYE_BOUNDS,
  turkiyeOverviewForViewport,
} from '@/lib/map/turkiye-overview';
import type { CatalogEvent } from '@/shared/schemas';
import type { MapBounds, MapCamera } from '@/shared/atlas-state';

const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/fiord';
const TERRAIN_TILEJSON = 'https://tiles.mapterhorn.com/tilejson.json';
const TERRAIN_SOURCE = 'atlas-terrain';
const HILLSHADE_SOURCE = 'atlas-hillshade';
const HILLSHADE_LAYER = 'atlas-terrain-hillshade';
const BUILDINGS_LAYER = 'atlas-buildings-3d';
const FAULTS_SOURCE = 'atlas-active-faults';
const FAULTS_CASING_LAYER = 'atlas-active-faults-casing';
const FAULTS_LAYER = 'atlas-active-faults-lines';
const FAULTS_SELECTED_LAYER = 'atlas-active-faults-selected';
const FAULTS_URL = '/data/faults/gem-active-faults-turkiye.pmtiles';
const EVENTS_SOURCE = 'atlas-events';
const EVENTS_GLOW_LAYER = 'atlas-events-glow';
const EVENTS_LAYER = 'atlas-events-points';
const EVENTS_LABEL_LAYER = 'atlas-events-labels';
const EVENTS_SELECTED_LAYER = 'atlas-events-selected';
const TURKIYE_CENTER: [number, number] = [35.35, 39.05];
const TERRAIN_EXAGGERATION = 1.3;

function fitTurkiyeOverview(map: MapLibreMap, duration: number) {
  const container = map.getContainer();
  const view = turkiyeOverviewForViewport(
    container.clientWidth,
    container.clientHeight,
  );
  map.fitBounds(TURKIYE_BOUNDS, {
    ...view,
    duration,
    curve: 1.25,
    essential: false,
  });
}

function createCircleImage(size: number) {
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size * 0.32;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const inside = Math.hypot(x - center, y - center) <= radius;
      data[offset] = 168;
      data[offset + 1] = 218;
      data[offset + 2] = 218;
      data[offset + 3] = inside ? 220 : 0;
    }
  }

  return { width: size, height: size, data };
}

function eventGeoJson(events: CatalogEvent[]) {
  return {
    type: 'FeatureCollection' as const,
    features: events.map((event) => ({
      type: 'Feature' as const,
      id: event.id,
      geometry: {
        type: 'Point' as const,
        coordinates: [event.longitude, event.latitude],
      },
      properties: {
        id: event.id,
        magnitude: event.magnitude ?? 0,
        depthKm: event.depthKm ?? -1,
        place: event.place ?? 'Unknown location',
      },
    })),
  };
}

type MapCanvasProps = {
  events: CatalogEvent[];
  eventsVisible: boolean;
  faultsVisible: boolean;
  faultOpacity: number;
  initialCamera: MapCamera | null;
  selectedEventId: string | null;
  nearestFaultId: string | null;
  onSelectEvent: (eventId: string) => void;
  onViewportChange: (bounds: MapBounds) => void;
  onCameraChange: (camera: MapCamera, userInitiated: boolean) => void;
  onResetView: () => void;
};

export function MapCanvas({
  events,
  eventsVisible,
  faultsVisible,
  faultOpacity,
  initialCamera,
  selectedEventId,
  nearestFaultId,
  onSelectEvent,
  onViewportChange,
  onCameraChange,
  onResetView,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const initialCameraRef = useRef(initialCamera);
  const eventsRef = useRef(events);
  const onSelectEventRef = useRef(onSelectEvent);
  const onViewportChangeRef = useRef(onViewportChange);
  const onCameraChangeRef = useRef(onCameraChange);
  const onResetViewRef = useRef(onResetView);
  const focusBeaconRef = useRef<HTMLDivElement>(null);
  const overviewModeRef = useRef(
    !initialCamera || isLegacyOverviewCamera(initialCamera),
  );
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  const [terrainReady, setTerrainReady] = useState(false);
  const [terrainEnabled, setTerrainEnabled] = useState(true);
  const [revealComplete, setRevealComplete] = useState(false);
  const selectedEvent =
    events.find((event) => event.id === selectedEventId) ?? null;

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    onSelectEventRef.current = onSelectEvent;
  }, [onSelectEvent]);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  }, [onCameraChange]);

  useEffect(() => {
    onResetViewRef.current = onResetView;
  }, [onResetView]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;
    let baseMapReady = false;
    let removePmtilesProtocol: (() => void) | null = null;
    let revealTimer: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let cameraChangedByUser = false;
    const markCameraInteraction = () => {
      cameraChangedByUser = true;
      overviewModeRef.current = false;
    };

    void Promise.all([import('maplibre-gl'), import('pmtiles')])
      .then(([{ default: maplibregl }, { PMTiles, Protocol }]) => {
        if (cancelled || !containerRef.current) return;

        const protocol = new Protocol({ metadata: true });
        maplibregl.addProtocol('pmtiles', protocol.tile);
        removePmtilesProtocol = () => maplibregl.removeProtocol('pmtiles');
        const faultArchiveUrl = new URL(FAULTS_URL, window.location.origin)
          .href;
        protocol.add(new PMTiles(faultArchiveUrl));

        const restoredCamera = initialCameraRef.current;
        const useOpeningView =
          !restoredCamera || isLegacyOverviewCamera(restoredCamera);
        overviewModeRef.current = useOpeningView;
        const reducedMotion = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches;
        const animateOpening = useOpeningView && !reducedMotion;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL ?? DEFAULT_STYLE,
          center: useOpeningView
            ? TURKIYE_CENTER
            : [restoredCamera!.longitude, restoredCamera!.latitude],
          zoom: useOpeningView ? 3.85 : restoredCamera!.zoom,
          pitch: useOpeningView ? 0 : restoredCamera!.pitch,
          bearing: useOpeningView ? 0 : restoredCamera!.bearing,
          minZoom: 3,
          maxZoom: 18,
          maxPitch: 78,
          attributionControl: false,
          canvasContextAttributes: { antialias: true },
        });
        const mapContainer = map.getContainer();
        mapContainer.addEventListener('pointerdown', markCameraInteraction);
        mapContainer.addEventListener('wheel', markCameraInteraction, {
          passive: true,
        });
        mapContainer.addEventListener('keydown', markCameraInteraction);

        map.addControl(
          new maplibregl.NavigationControl({
            showCompass: true,
            showZoom: true,
            visualizePitch: true,
          }),
          'bottom-right',
        );
        map.addControl(
          new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }),
          'bottom-left',
        );
        map.addControl(
          new maplibregl.AttributionControl({ compact: true }),
          'bottom-left',
        );

        map.on('styleimagemissing', (event) => {
          if (event.id === 'circle-11' && !map.hasImage(event.id)) {
            map.addImage(event.id, createCircleImage(22), { pixelRatio: 2 });
          }
        });

        map.on('load', () => {
          if (cancelled) return;
          baseMapReady = true;

          map.addSource(TERRAIN_SOURCE, {
            type: 'raster-dem',
            url: TERRAIN_TILEJSON,
            tileSize: 256,
          });
          map.addSource(HILLSHADE_SOURCE, {
            type: 'raster-dem',
            url: TERRAIN_TILEJSON,
            tileSize: 256,
          });

          map.addLayer(
            {
              id: HILLSHADE_LAYER,
              type: 'hillshade',
              source: HILLSHADE_SOURCE,
              paint: {
                'hillshade-accent-color': '#4d8792',
                'hillshade-exaggeration': 0.34,
                'hillshade-highlight-color': '#d8f4ed',
                'hillshade-illumination-anchor': 'map',
                'hillshade-illumination-direction': 322,
                'hillshade-shadow-color': '#071821',
              },
            },
            map.getLayer('building') ? 'building' : undefined,
          );

          if (map.getSource('openmaptiles')) {
            map.addLayer(
              {
                id: BUILDINGS_LAYER,
                type: 'fill-extrusion',
                source: 'openmaptiles',
                'source-layer': 'building',
                minzoom: 14,
                paint: {
                  'fill-extrusion-base': [
                    'coalesce',
                    ['get', 'render_min_height'],
                    0,
                  ],
                  'fill-extrusion-color': '#789aa3',
                  'fill-extrusion-height': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    14,
                    0,
                    14.4,
                    ['coalesce', ['get', 'render_height'], 8],
                  ],
                  'fill-extrusion-opacity': 0.72,
                },
              },
              map.getLayer('water_name') ? 'water_name' : undefined,
            );
          }

          map.addSource(FAULTS_SOURCE, {
            type: 'vector',
            url: `pmtiles://${faultArchiveUrl}`,
            attribution:
              '<a href="https://github.com/GEMScienceTools/gem-global-active-faults" target="_blank" rel="noreferrer">© GEM Foundation contributors · CC BY-SA 4.0</a>',
          });
          map.addLayer({
            id: FAULTS_CASING_LAYER,
            type: 'line',
            source: FAULTS_SOURCE,
            'source-layer': 'active_faults',
            minzoom: 4,
            paint: {
              'line-color': '#07141d',
              'line-opacity': 0.8,
              'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                4,
                2.8,
                8,
                4.5,
                12,
                7,
              ],
            },
          });
          map.addLayer({
            id: FAULTS_LAYER,
            type: 'line',
            source: FAULTS_SOURCE,
            'source-layer': 'active_faults',
            minzoom: 4,
            paint: {
              'line-color': [
                'match',
                ['get', 'slip_type'],
                ['Dextral', 'Sinistral', 'Strike-Slip'],
                '#f472b6',
                [
                  'Normal',
                  'Dextral-Normal',
                  'Sinistral-Normal',
                  'Spreading_Ridge',
                ],
                '#22d3ee',
                [
                  'Reverse',
                  'Dextral-Reverse',
                  'Sinistral-Reverse',
                  'Subduction_Thrust',
                ],
                '#fb923c',
                '#e2e8f0',
              ],
              'line-opacity': 0.82,
              'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                4,
                1,
                8,
                2,
                12,
                3.4,
              ],
            },
          });
          map.addLayer({
            id: FAULTS_SELECTED_LAYER,
            type: 'line',
            source: FAULTS_SOURCE,
            'source-layer': 'active_faults',
            minzoom: 4,
            filter: ['==', ['get', 'id'], ''],
            paint: {
              'line-blur': 1.2,
              'line-color': '#ffffff',
              'line-opacity': 0.95,
              'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                4,
                3,
                9,
                7,
                12,
                11,
              ],
            },
          });

          map.addSource(EVENTS_SOURCE, {
            type: 'geojson',
            data: eventGeoJson(eventsRef.current),
          });
          map.addLayer({
            id: EVENTS_GLOW_LAYER,
            type: 'circle',
            source: EVENTS_SOURCE,
            paint: {
              'circle-blur': 0.7,
              'circle-color': '#67e8f9',
              'circle-opacity': 0.48,
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['get', 'magnitude'],
                0,
                8,
                3,
                14,
                5,
                24,
                7,
                38,
              ],
            },
          });
          map.addLayer({
            id: EVENTS_LAYER,
            type: 'circle',
            source: EVENTS_SOURCE,
            paint: {
              'circle-color': [
                'step',
                ['get', 'magnitude'],
                '#67e8f9',
                3,
                '#facc15',
                4,
                '#fb923c',
                5,
                '#fb7185',
              ],
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['get', 'magnitude'],
                0,
                3.5,
                3,
                6,
                5,
                10,
                7,
                16,
              ],
              'circle-stroke-color': '#ecfeff',
              'circle-stroke-opacity': 0.9,
              'circle-stroke-width': 1.25,
            },
          });
          map.addLayer({
            id: EVENTS_SELECTED_LAYER,
            type: 'circle',
            source: EVENTS_SOURCE,
            filter: ['==', ['get', 'id'], ''],
            paint: {
              'circle-color': 'rgba(0,0,0,0)',
              'circle-radius': 14,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 3,
            },
          });
          map.addLayer({
            id: EVENTS_LABEL_LAYER,
            type: 'symbol',
            source: EVENTS_SOURCE,
            filter: ['>=', ['get', 'magnitude'], 3],
            layout: {
              'text-field': [
                'concat',
                'M ',
                ['to-string', ['get', 'magnitude']],
              ],
              'text-font': ['Noto Sans Regular'],
              'text-offset': [0, 1.35],
              'text-size': 11,
            },
            paint: {
              'text-color': '#ffffff',
              'text-halo-color': '#07141d',
              'text-halo-width': 1.5,
            },
          });

          map.on('mouseenter', EVENTS_LAYER, () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', EVENTS_LAYER, () => {
            map.getCanvas().style.cursor = '';
          });
          map.on('click', EVENTS_LAYER, (event) => {
            const eventId = event.features?.[0]?.properties?.id;
            if (typeof eventId === 'string') onSelectEventRef.current(eventId);
          });

          const emitMapState = () => {
            const bounds = map.getBounds();
            const center = map.getCenter();
            onViewportChangeRef.current({
              minLat: Math.max(-90, bounds.getSouth()),
              maxLat: Math.min(90, bounds.getNorth()),
              minLon: Math.max(-180, bounds.getWest()),
              maxLon: Math.min(180, bounds.getEast()),
            });
            onCameraChangeRef.current(
              {
                longitude: center.lng,
                latitude: center.lat,
                zoom: map.getZoom(),
                pitch: map.getPitch(),
                bearing: map.getBearing(),
              },
              cameraChangedByUser,
            );
            cameraChangedByUser = false;
          };

          map.on('movestart', (event) => {
            if (event.originalEvent) markCameraInteraction();
          });
          map.on('moveend', emitMapState);
          emitMapState();

          map.setTerrain({
            source: TERRAIN_SOURCE,
            exaggeration: TERRAIN_EXAGGERATION,
          });
          map.setSky({
            'sky-color': '#041019',
            'horizon-color': '#315f6b',
            'fog-color': '#17343e',
            'sky-horizon-blend': 0.46,
            'horizon-fog-blend': 0.66,
            'fog-ground-blend': 0.2,
            'atmosphere-blend': [
              'interpolate',
              ['linear'],
              ['zoom'],
              3,
              1,
              9,
              0.15,
            ],
          });
          map.setLight({
            anchor: 'map',
            color: '#dcf5ef',
            intensity: 0.38,
            position: [1.15, 315, 46],
          });

          setTerrainReady(true);
          setMapState('ready');
          revealTimer = window.setTimeout(() => setRevealComplete(true), 750);

          if (useOpeningView) {
            window.requestAnimationFrame(() => {
              fitTurkiyeOverview(map, animateOpening ? 1_700 : 0);
            });
          }

          resizeObserver = new ResizeObserver(() => {
            map.resize();
            if (overviewModeRef.current) fitTurkiyeOverview(map, 0);
          });
          resizeObserver.observe(map.getContainer());
        });

        map.on('error', () => {
          if (!cancelled && !baseMapReady) {
            setMapState('unavailable');
          }
        });
        mapRef.current = map;
      })
      .catch(() => {
        if (!cancelled) setMapState('unavailable');
      });

    return () => {
      cancelled = true;
      const mapContainer = mapRef.current?.getContainer();
      mapContainer?.removeEventListener('pointerdown', markCameraInteraction);
      mapContainer?.removeEventListener('wheel', markCameraInteraction);
      mapContainer?.removeEventListener('keydown', markCameraInteraction);
      mapRef.current?.remove();
      mapRef.current = null;
      removePmtilesProtocol?.();
      resizeObserver?.disconnect();
      if (revealTimer !== null) window.clearTimeout(revealTimer);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource(EVENTS_SOURCE);
    if (source) (source as GeoJSONSource).setData(eventGeoJson(events));
  }, [events]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visibility = eventsVisible ? 'visible' : 'none';
    for (const layer of [
      EVENTS_GLOW_LAYER,
      EVENTS_LAYER,
      EVENTS_SELECTED_LAYER,
      EVENTS_LABEL_LAYER,
    ]) {
      if (map.getLayer(layer))
        map.setLayoutProperty(layer, 'visibility', visibility);
    }
  }, [eventsVisible, mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visibility = faultsVisible ? 'visible' : 'none';
    for (const layer of [
      FAULTS_CASING_LAYER,
      FAULTS_LAYER,
      FAULTS_SELECTED_LAYER,
    ]) {
      if (map.getLayer(layer))
        map.setLayoutProperty(layer, 'visibility', visibility);
    }
  }, [faultsVisible, mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer(FAULTS_CASING_LAYER)) {
      map.setPaintProperty(
        FAULTS_CASING_LAYER,
        'line-opacity',
        Math.min(1, faultOpacity * 0.9),
      );
    }
    if (map.getLayer(FAULTS_LAYER)) {
      map.setPaintProperty(FAULTS_LAYER, 'line-opacity', faultOpacity);
    }
  }, [faultOpacity, mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer(FAULTS_SELECTED_LAYER)) return;
    map.setFilter(FAULTS_SELECTED_LAYER, [
      '==',
      ['get', 'id'],
      nearestFaultId ?? '',
    ]);
  }, [mapState, nearestFaultId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer(EVENTS_SELECTED_LAYER)) return;

    map.setFilter(EVENTS_SELECTED_LAYER, [
      '==',
      ['get', 'id'],
      selectedEventId ?? '',
    ]);

    const selected = events.find((event) => event.id === selectedEventId);
    if (!selected) return;

    overviewModeRef.current = false;
    const container = map.getContainer();
    const syncFocusBeacon = () => {
      const beacon = focusBeaconRef.current;
      if (!beacon) return;
      const point = map.project([selected.longitude, selected.latitude]);
      const containerBounds = container.getBoundingClientRect();
      const left = containerBounds.left + point.x;
      const top = containerBounds.top + point.y;
      beacon.style.left = `${left}px`;
      beacon.style.top = `${top}px`;
      beacon.style.opacity =
        left >= 0 &&
        left <= window.innerWidth &&
        top >= 0 &&
        top <= window.innerHeight
          ? '1'
          : '0';
    };
    const focus = eventFocusForViewport(
      container.clientWidth,
      container.clientHeight,
      window.innerWidth,
    );

    map.on('move', syncFocusBeacon);
    map.on('resize', syncFocusBeacon);
    syncFocusBeacon();
    map.easeTo({
      center: [selected.longitude, selected.latitude],
      zoom: Math.max(map.getZoom(), 7),
      pitch: terrainEnabled ? focus.pitch : 0,
      offset: focus.offset,
      duration: 850,
    });

    return () => {
      map.off('move', syncFocusBeacon);
      map.off('resize', syncFocusBeacon);
    };
  }, [events, selectedEventId, terrainEnabled]);

  function resetView() {
    const map = mapRef.current;
    if (!map) return;
    overviewModeRef.current = true;
    onResetViewRef.current();
    if (terrainEnabled) fitTurkiyeOverview(map, 900);
    else {
      const container = map.getContainer();
      const view = turkiyeOverviewForViewport(
        container.clientWidth,
        container.clientHeight,
      );
      map.fitBounds(TURKIYE_BOUNDS, {
        ...view,
        pitch: 0,
        bearing: 0,
        duration: 900,
      });
    }
  }

  function setTerrain(enabled: boolean) {
    const map = mapRef.current;
    if (!map || !terrainReady) return;

    map.setTerrain(
      enabled
        ? { source: TERRAIN_SOURCE, exaggeration: TERRAIN_EXAGGERATION }
        : null,
    );
    const container = map.getContainer();
    const overview = turkiyeOverviewForViewport(
      container.clientWidth,
      container.clientHeight,
    );
    map.easeTo({
      pitch: enabled ? overview.pitch : 0,
      bearing: enabled ? overview.bearing : 0,
      duration: 700,
    });
    setTerrainEnabled(enabled);
  }

  return (
    <div className="relative h-full min-h-[360px] w-full overflow-hidden bg-[#07141d]">
      <div
        ref={containerRef}
        className="h-full min-h-[360px] w-full"
        aria-label="Interactive 3D terrain map of Türkiye"
      />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_52%_42%,transparent_42%,rgba(3,12,18,0.38)_100%),linear-gradient(to_bottom,rgba(3,12,18,0.18),transparent_22%,transparent_72%,rgba(3,12,18,0.28))]" />

      {selectedEvent && (
        <div
          ref={focusBeaconRef}
          data-selected-event-beacon=""
          className="pointer-events-none fixed z-[60] hidden -translate-x-1/2 -translate-y-1/2 place-items-center opacity-0 transition-opacity duration-200 sm:grid"
          aria-hidden="true"
        >
          <span className="absolute size-20 animate-ping rounded-full border border-cyan-200/35 bg-cyan-300/10 motion-reduce:animate-none" />
          <span className="absolute size-12 rounded-full border border-cyan-100/60 bg-cyan-300/15 shadow-[0_0_32px_rgba(103,232,249,0.85)]" />
          <span className="relative size-4 rounded-full border-2 border-white bg-cyan-300 shadow-[0_0_0_5px_rgba(8,25,34,0.85),0_0_24px_rgba(255,255,255,0.95)]" />
          <span className="absolute top-8 rounded-full border border-white/20 bg-[#07141d] px-2 py-1 font-mono text-xs font-semibold text-white shadow-xl">
            M{selectedEvent.magnitude?.toFixed(1) ?? '—'}
          </span>
        </div>
      )}

      <div className="absolute right-3 top-3 flex items-center gap-2 rounded-full border border-white/10 bg-[#07141d]/82 p-1.5 shadow-2xl backdrop-blur-xl">
        <Toggle
          pressed={terrainEnabled}
          onPressedChange={setTerrain}
          disabled={!terrainReady}
          variant="outline"
          aria-label="Toggle 3D terrain"
          className="rounded-full border-white/10 bg-white/5 px-3 text-slate-100 hover:bg-white/10 data-[state=on]:bg-cyan-300 data-[state=on]:text-slate-950"
        >
          <Mountain className="size-4" aria-hidden="true" />
          3D
        </Toggle>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={resetView}
          aria-label="Reset map to Türkiye"
          className="rounded-full text-slate-200 hover:bg-white/10 hover:text-white"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Reset</span>
        </Button>
      </div>

      <div className="pointer-events-none absolute left-3 top-3 hidden items-center gap-3 rounded-full border border-white/10 bg-[#07141d]/78 px-3.5 py-2 text-xs text-slate-200 shadow-xl backdrop-blur-lg md:flex">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-70 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
        </span>
        <span className="font-semibold uppercase tracking-[0.14em] text-slate-100">
          Live atlas
        </span>
        <span className="h-3 w-px bg-white/15" />
        <span className="text-slate-300">
          {events.length > 0
            ? `${events.length.toLocaleString()} AFAD events · GEM faults`
            : 'Türkiye · 3D terrain'}
        </span>
      </div>

      {!revealComplete && (
        <div
          className={`pointer-events-none absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_46%,rgba(57,206,210,0.17),transparent_38%),linear-gradient(rgba(255,255,255,0.022)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px),#06131c] bg-[size:auto,48px_48px,48px_48px,auto] transition-opacity duration-700 ${
            mapState === 'ready' ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <div className="text-center text-slate-300">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full border border-cyan-300/25 bg-cyan-300/10 shadow-[0_0_45px_rgba(103,232,249,0.14)]">
              <LocateFixed
                className="size-5 animate-pulse text-cyan-300 motion-reduce:animate-none"
                aria-hidden="true"
              />
            </div>
            <p className="text-sm font-medium tracking-wide text-slate-100">
              Seismic Atlas
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {mapState === 'unavailable'
                ? 'Terrain unavailable · controls remain active'
                : 'Preparing terrain and seismic layers'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
