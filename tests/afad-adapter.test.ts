import { describe, expect, it } from 'vitest';
import {
  fetchAfadWindow,
  fetchAfadWindowWithDiagnostics,
  normalizeAfadEvent,
} from '@/worker/sources/afad';

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

  it('retries transient upstream failures with a bounded attempt count', async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      if (attempts === 1) return Response.json({}, { status: 503 });
      if (attempts === 2) return Response.json({}, { status: 429 });
      return Response.json([fixture]);
    };

    const result = await fetchAfadWindowWithDiagnostics(
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-03T00:00:00.000Z'),
      fetcher as typeof fetch,
      { maxAttempts: 3, sleep: async () => {} },
    );

    expect(result.attempts).toBe(3);
    expect(result.events).toHaveLength(1);
  });

  it('quarantines malformed rows and deduplicates an upstream batch', async () => {
    const fetcher = async () =>
      Response.json([
        fixture,
        { eventID: 'invalid-row' },
        {
          ...fixture,
          magnitude: '2.1',
          isEventUpdate: true,
          lastUpdateDate: '2026-09-03T02:00:00',
        },
      ]);

    const result = await fetchAfadWindowWithDiagnostics(
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-03T00:00:00.000Z'),
      fetcher as typeof fetch,
    );

    expect(result.received).toBe(3);
    expect(result.rejected).toBe(1);
    expect(result.rejections).toEqual([
      expect.objectContaining({
        sourceEventId: 'invalid-row',
        reason: expect.stringContaining('date:'),
      }),
    ]);
    expect(result.duplicatesDropped).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.magnitude).toBe(2.1);
    expect(result.events[0]?.sourceStatus).toBe('updated');
  });

  it('fails closed when every returned record is malformed', async () => {
    const fetcher = async () =>
      Response.json(
        Array.from({ length: 30 }, (_, index) => ({
          eventID: `invalid-${index + 1}`,
        })),
      );

    try {
      await fetchAfadWindowWithDiagnostics(
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2026-09-03T00:00:00.000Z'),
        fetcher as typeof fetch,
      );
      expect.unreachable('Expected an all-invalid AFAD response to fail closed');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'AFAD_NO_VALID_EVENTS',
        attempts: 1,
      });
      expect(
        (error as { rejections?: Array<{ sourceEventId: string | null }> })
          .rejections,
      ).toHaveLength(25);
      expect(
        (error as { rejections: Array<{ sourceEventId: string | null }> })
          .rejections[0],
      ).toMatchObject({ sourceEventId: 'invalid-1' });
      expect(
        (error as { rejections: Array<{ sourceEventId: string | null }> })
          .rejections[24],
      ).toMatchObject({ sourceEventId: 'invalid-25' });
    }
  });
});
