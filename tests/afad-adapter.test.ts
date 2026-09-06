import { describe, expect, it } from 'vitest';
import { fetchAfadWindow, normalizeAfadEvent } from '@/worker/sources/afad';

const fixture = {
  rms: '0.49',
  eventID: '727627',
  location: 'Çat (Erzurum)',
  latitude: '39.6625',
  longitude: '40.72433',
  depth: '6.99',
  type: 'ML',
  magnitude: '1.8',
  country: 'Türkiye',
  province: 'Erzurum',
  district: 'Çat',
  neighborhood: 'Muratçayırı',
  date: '2026-09-03T01:01:30',
  isEventUpdate: false,
  lastUpdateDate: null,
};

describe('AFAD adapter', () => {
  it('normalizes numeric strings and treats source timestamps as UTC', () => {
    expect(normalizeAfadEvent(fixture)).toEqual({
      source: 'AFAD',
      sourceEventId: '727627',
      originTime: '2026-09-03T01:01:30.000Z',
      latitude: 39.6625,
      longitude: 40.72433,
      depthKm: 6.99,
      magnitude: 1.8,
      magnitudeType: 'ML',
      placeRaw: 'Çat (Erzurum)',
      sourceStatus: 'original',
      sourceUpdatedAt: null,
    });
  });

  it('uses a bounded Türkiye request and follows the official JSON redirect', async () => {
    let requestedUrl: URL | undefined;
    let requestedOptions: RequestInit | undefined;
    const fetcher = async (input: RequestInfo | URL, options?: RequestInit) => {
      requestedUrl =
        input instanceof URL
          ? input
          : typeof input === 'string'
            ? new URL(input)
            : new URL(input.url);
      requestedOptions = options;
      return Response.json([fixture]);
    };
    const events = await fetchAfadWindow(
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-03T00:00:00.000Z'),
      fetcher as typeof fetch,
    );

    expect(requestedUrl?.searchParams.get('start')).toBe('2026-09-01T00:00:00');
    expect(requestedUrl?.searchParams.get('end')).toBe('2026-09-03T00:00:00');
    expect(requestedUrl?.searchParams.get('minlat')).toBe('34');
    expect(requestedUrl?.searchParams.get('maxlon')).toBe('46');
    expect(requestedOptions?.redirect).toBe('follow');
    expect(events).toHaveLength(1);
  });
});
