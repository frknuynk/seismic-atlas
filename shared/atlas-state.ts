export type TimeRangeHours = 24 | 72 | 168;

export type AtlasFilters = {
  rangeHours: TimeRangeHours;
  minMagnitude: number;
  maxDepth: number;
};

export type MapBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

export type MapCamera = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

export const DEFAULT_ATLAS_FILTERS: AtlasFilters = {
  rangeHours: 168,
  minMagnitude: 0,
  maxDepth: 300,
};
