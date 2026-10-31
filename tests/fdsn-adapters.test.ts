import { describe, expect, it } from 'vitest';
import {
  fetchUsgsWindowWithDiagnostics,
  normalizeUsgsEvent,
} from '@/worker/sources/usgs';
import {
  fetchEmscWindowWithDiagnostics,
  normalizeEmscEvent,
} from '@/worker/sources/emsc';

const start = new Date('2026-10-01T00:00:00.000Z');
const end = new Date('2026-10-02T00:00:00.000Z');

const usgsFeature = {
  type: 'Feature',
  id: 'us7000test',
  geometry: { type: 'Point', coordinates: [35.25, 38.7, 8.4] },
  properties: {
    time: Date.parse('2026-10-01T12:30:00.000Z'),
    updated: Date.parse('2026-10-01T12:35:00.000Z'),
    mag: 3.2,
    magType: 'ml',
    place: 'Central Turkey',
    status: 'reviewed',
    type: 'earthquake',
  },
};

const emscFeature = {
  type: 'Feature',
  id: '20261001_000001',
  properties: {
    unid: '20261001_000001',
    time: '2026-10-01T12:31:00.000Z',
    lat: 38.71,
    lon: 35.26,
    depth: 9,
    mag: 3.1,
    magtype: 'ML',
    flynn_region: 'CENTRAL TURKEY',
    evtype: 'ke',
    lastupdate: '2026-10-01T12:36:00.000Z',
  },
};

describe('FDSN source adapters', () => {
  it('normalizes a USGS GeoJSON feature without losing source provenance', () => {
    expect(normalizeUsgsEvent(usgsFeature)).toEqual({
      source: 'USGS',
      sourceEventId: 'us7000test',
      originTime: '2026-10-01T12:30:00.000Z',
      latitude: 38.7,
      longitude: 35.25,
      depthKm: 8.4,
      magnitude: 3.2,
      magnitudeType: 'ml',
      placeRaw: 'Central Turkey',
      sourceStatus: 'reviewed',
      sourceUpdatedAt: '2026-10-01T12:35:00.000Z',
    });
  });

  it('queries the bounded Türkiye USGS catalog and retries transient failures', async () => {
    const urls: URL[] = [];
    const delays: number[] = [];
    let attempts = 0;
    const result = await fetchUsgsWindowWithDiagnostics(
      start,
      end,
      async (input) => {
        urls.push(
          input instanceof URL
            ? input
            : typeof input === 'string'
              ? new URL(input)
              : new URL(input.url),
        );
        attempts += 1;
        if (attempts === 1) return new Response(null, { status: 503 });
        return Response.json({
          type: 'FeatureCollection',
          features: [usgsFeature],
        });
      },
      {
        random: () => 0,
        sleep: async (delay) => {
          delays.push(delay);
        },
      },
    );

    expect(urls.at(-1)?.hostname).toBe('earthquake.usgs.gov');
    expect(urls.at(-1)?.searchParams.get('minlatitude')).toBe('34');
    expect(urls.at(-1)?.searchParams.get('maxlongitude')).toBe('46');
    expect(urls.at(-1)?.searchParams.get('eventtype')).toBe('earthquake');
    expect(delays).toEqual([2_000]);
    expect(result).toMatchObject({ attempts: 2, received: 1, rejected: 0 });
    expect(result.events).toHaveLength(1);
  });

  it('normalizes EMSC independently and quarantines malformed rows', async () => {
    expect(normalizeEmscEvent(emscFeature)).toMatchObject({
      source: 'EMSC',
      sourceEventId: '20261001_000001',
      latitude: 38.71,
      longitude: 35.26,
      magnitude: 3.1,
    });

    const result = await fetchEmscWindowWithDiagnostics(
      start,
      end,
      async () =>
        Response.json({
          type: 'FeatureCollection',
          features: [emscFeature, { id: 'broken', properties: {} }],
        }),
    );

    expect(result.events).toHaveLength(1);
    expect(result.rejected).toBe(1);
    expect(result.rejections[0]?.sourceEventId).toBe('broken');
  });

  it('treats an FDSN 204 response as a successful empty window', async () => {
    const result = await fetchUsgsWindowWithDiagnostics(
      start,
      end,
      async () => new Response(null, { status: 204 }),
    );

    expect(result).toMatchObject({
      events: [],
      attempts: 1,
      received: 0,
      rejected: 0,
    });
  });
});
