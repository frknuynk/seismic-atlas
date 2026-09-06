'use client';

import { LocateFixed, Mountain, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
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
const TURKIYE_CENTER: [number, number] = [35.2, 38.65];
const TURKIYE_ZOOM = 5.5;
const TERRAIN_PITCH = 62;
const TERRAIN_BEARING = -15;
const TERRAIN_EXAGGERATION = 1.55;

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
  onCameraChange: (camera: MapCamera) => void;
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
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const eventsRef = useRef(events);
  const onSelectEventRef = useRef(onSelectEvent);
  const onViewportChangeRef = useRef(onViewportChange);
  const onCameraChangeRef = useRef(onCameraChange);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  const [terrainReady, setTerrainReady] = useState(false);
  const [terrainEnabled, setTerrainEnabled] = useState(true);

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
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;
    let baseMapReady = false;
    let removePmtilesProtocol: (() => void) | null = null;

    void Promise.all([import('maplibre-gl'), import('pmtiles')])
      .then(([{ default: maplibregl }, { PMTiles, Protocol }]) => {
        if (cancelled || !containerRef.current) return;

        const protocol = new Protocol({ metadata: true });
        maplibregl.addProtocol('pmtiles', protocol.tile);
        removePmtilesProtocol = () => maplibregl.removeProtocol('pmtiles');
        const faultArchiveUrl = new URL(FAULTS_URL, window.location.origin)
          .href;
        protocol.add(new PMTiles(faultArchiveUrl));

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL ?? DEFAULT_STYLE,
          center: TURKIYE_CENTER,
          zoom: TURKIYE_ZOOM,
          pitch: TERRAIN_PITCH,
          bearing: TERRAIN_BEARING,
          minZoom: 3,
          maxZoom: 18,
          maxPitch: 78,
          attributionControl: false,
          canvasContextAttributes: { antialias: true },
        });

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
                'hillshade-exaggeration': 0.42,
                'hillshade-highlight-color': '#c9eee5',
                'hillshade-illumination-anchor': 'map',
                'hillshade-illumination-direction': 322,
                'hillshade-shadow-color': '#06131d',
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
            onCameraChangeRef.current({
              longitude: center.lng,
              latitude: center.lat,
              zoom: map.getZoom(),
              pitch: map.getPitch(),
              bearing: map.getBearing(),
            });
          };

          map.on('moveend', emitMapState);
          emitMapState();

          map.setTerrain({
            source: TERRAIN_SOURCE,
            exaggeration: TERRAIN_EXAGGERATION,
          });
          map.setSky({
            'sky-color': '#06121b',
            'horizon-color': '#416b76',
            'fog-color': '#193944',
            'sky-horizon-blend': 0.38,
            'horizon-fog-blend': 0.72,
            'fog-ground-blend': 0.16,
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
            color: '#d6f2ee',
            intensity: 0.42,
            position: [1.25, 322, 48],
          });

          setTerrainReady(true);
          setMapState('ready');
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
      mapRef.current?.remove();
      mapRef.current = null;
      removePmtilesProtocol?.();
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
    if (!map || !initialCamera || mapState !== 'ready') return;
    map.jumpTo({
      center: [initialCamera.longitude, initialCamera.latitude],
      zoom: initialCamera.zoom,
      pitch: initialCamera.pitch,
      bearing: initialCamera.bearing,
    });
  }, [initialCamera, mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer(EVENTS_SELECTED_LAYER)) return;

    map.setFilter(EVENTS_SELECTED_LAYER, [
      '==',
      ['get', 'id'],
      selectedEventId ?? '',
    ]);

    const selected = events.find((event) => event.id === selectedEventId);
    if (selected) {
      map.easeTo({
        center: [selected.longitude, selected.latitude],
        zoom: Math.max(map.getZoom(), 7),
        pitch: terrainEnabled ? TERRAIN_PITCH : 0,
        duration: 850,
      });
    }
  }, [events, selectedEventId, terrainEnabled]);

  function resetView() {
    mapRef.current?.easeTo({
      center: TURKIYE_CENTER,
      zoom: TURKIYE_ZOOM,
      pitch: terrainEnabled ? TERRAIN_PITCH : 0,
      bearing: terrainEnabled ? TERRAIN_BEARING : 0,
      duration: 900,
    });
  }

  function setTerrain(enabled: boolean) {
    const map = mapRef.current;
    if (!map || !terrainReady) return;

    map.setTerrain(
      enabled
        ? { source: TERRAIN_SOURCE, exaggeration: TERRAIN_EXAGGERATION }
        : null,
    );
    map.easeTo({
      pitch: enabled ? TERRAIN_PITCH : 0,
      bearing: enabled ? TERRAIN_BEARING : 0,
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

      <div className="absolute right-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-[#07141d]/86 p-1.5 shadow-2xl backdrop-blur-xl">
        <Toggle
          pressed={terrainEnabled}
          onPressedChange={setTerrain}
          disabled={!terrainReady}
          variant="outline"
          aria-label="Toggle 3D terrain"
          className="border-white/10 bg-white/5 px-3 text-slate-100 hover:bg-white/10 data-[state=on]:bg-cyan-300 data-[state=on]:text-slate-950"
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
          className="text-slate-200 hover:bg-white/10 hover:text-white"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Reset</span>
        </Button>
      </div>

      <div className="pointer-events-none absolute left-3 top-3 hidden items-center gap-2 rounded-full border border-white/10 bg-[#07141d]/78 px-3 py-1.5 text-xs font-medium tracking-wide text-slate-200 shadow-xl backdrop-blur-lg md:flex">
        <LocateFixed className="size-3.5 text-cyan-300" aria-hidden="true" />
        {events.length > 0
          ? `${events.length.toLocaleString()} AFAD events · 7 days`
          : 'Türkiye · terrain 1.55×'}
      </div>

      {mapState !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,rgba(57,206,210,0.14),transparent_42%),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:auto,42px_42px,42px_42px]">
          <div className="rounded-lg border border-white/10 bg-[#091821]/92 px-4 py-3 text-center text-sm text-slate-300 shadow-2xl backdrop-blur-xl">
            <Mountain
              className="mx-auto mb-2 size-5 text-cyan-300"
              aria-hidden="true"
            />
            {mapState === 'loading'
              ? 'Loading 3D terrain…'
              : 'Terrain is unavailable. Atlas controls remain available.'}
          </div>
        </div>
      )}
    </div>
  );
}
