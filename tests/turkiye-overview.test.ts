import { describe, expect, it } from 'vitest';
import {
  isLegacyOverviewCamera,
  turkiyeOverviewForViewport,
} from '@/lib/map/turkiye-overview';

describe('Türkiye overview framing', () => {
  it('reserves room for mobile controls without using a steep camera', () => {
    const view = turkiyeOverviewForViewport(390, 844);

    expect(view.padding.bottom).toBeGreaterThan(view.padding.top);
    expect(view.pitch).toBe(24);
    expect(view.maxZoom).toBeLessThanOrEqual(5.25);
    expect(view.offset[1]).toBeLessThan(0);
  });

  it('uses the available width on desktop while keeping Türkiye above overlays', () => {
    const view = turkiyeOverviewForViewport(1_600, 900);

    expect(view.padding.left).toBe(72);
    expect(view.padding.right).toBe(72);
    expect(view.padding.bottom).toBeGreaterThan(view.padding.top);
    expect(view.pitch).toBe(30);
    expect(view.maxZoom).toBe(5.7);
  });

  it('reduces perspective on short landscape displays', () => {
    expect(turkiyeOverviewForViewport(900, 500).pitch).toBe(18);
  });

  it('migrates old fixed opening cameras back to responsive framing', () => {
    expect(
      isLegacyOverviewCamera({
        longitude: 35.35,
        latitude: 39.05,
        zoom: 5.15,
        pitch: 48,
        bearing: -9,
      }),
    ).toBe(true);
    expect(
      isLegacyOverviewCamera({
        longitude: 29.1,
        latitude: 41.05,
        zoom: 8,
        pitch: 36,
        bearing: 0,
      }),
    ).toBe(false);
  });
});
