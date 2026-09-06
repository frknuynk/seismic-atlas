import type { MapCamera } from '@/shared/atlas-state';

export const TURKIYE_BOUNDS: [[number, number], [number, number]] = [
  [25.4, 35.7],
  [45.2, 42.25],
];

const LEGACY_OVERVIEW_CAMERAS: MapCamera[] = [
  { longitude: 35.2, latitude: 38.65, zoom: 5.5, pitch: 62, bearing: -15 },
  { longitude: 35.35, latitude: 39.05, zoom: 5.15, pitch: 48, bearing: -9 },
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function isLegacyOverviewCamera(camera: MapCamera | null) {
  if (!camera) return false;
  return LEGACY_OVERVIEW_CAMERAS.some(
    (legacy) =>
      Math.abs(camera.longitude - legacy.longitude) < 0.001 &&
      Math.abs(camera.latitude - legacy.latitude) < 0.001 &&
      Math.abs(camera.zoom - legacy.zoom) < 0.01 &&
      Math.abs(camera.pitch - legacy.pitch) < 0.1 &&
      Math.abs(camera.bearing - legacy.bearing) < 0.1,
  );
}

export function turkiyeOverviewForViewport(width: number, height: number) {
  const compact = width < 720;
  const short = height < 620;
  const horizontalPadding = clamp(width * 0.045, 24, 72);
  const topPadding = clamp(height * 0.07, 32, 72);
  const bottomPadding = compact
    ? clamp(height * 0.24, 110, 190)
    : clamp(height * 0.14, 88, 140);

  return {
    padding: {
      top: topPadding,
      right: horizontalPadding,
      bottom: bottomPadding,
      left: horizontalPadding,
    },
    offset: [0, -clamp(height * (compact ? 0.035 : 0.065), 18, 68)] as [
      number,
      number,
    ],
    pitch: short ? 18 : compact ? 24 : 30,
    bearing: -3,
    maxZoom: compact ? 5.25 : 5.7,
  };
}
