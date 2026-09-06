import { describe, expect, it } from 'vitest';
import {
  EventQuerySchema,
  NormalizedSourceEventSchema,
} from '@/shared/schemas';

describe('NormalizedSourceEventSchema', () => {
  it('preserves an explicitly unknown depth as null', () => {
    const event = NormalizedSourceEventSchema.parse({
      source: 'AFAD',
      sourceEventId: 'fixture-1',
      originTime: '2026-09-06T10:00:00.000Z',
      latitude: 40.9,
      longitude: 28.7,
      depthKm: null,
      magnitude: 2.8,
      magnitudeType: 'ML',
      placeRaw: 'Marmara Sea',
      sourceStatus: null,
      sourceUpdatedAt: null,
    });

    expect(event.depthKm).toBeNull();
  });

  it('rejects impossible coordinates', () => {
    const result = NormalizedSourceEventSchema.safeParse({
      source: 'AFAD',
      sourceEventId: 'fixture-2',
      originTime: '2026-09-06T10:00:00.000Z',
      latitude: 140,
      longitude: 28.7,
      depthKm: 8,
      magnitude: 2.8,
      magnitudeType: 'ML',
      placeRaw: null,
      sourceStatus: null,
      sourceUpdatedAt: null,
    });

    expect(result.success).toBe(false);
  });
});

describe('EventQuerySchema', () => {
  it('requires a forward, bounded interval', () => {
    const result = EventQuerySchema.safeParse({
      start: '2026-09-07T00:00:00.000Z',
      end: '2026-09-06T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('applies a quota-safe default limit', () => {
    const query = EventQuerySchema.parse({
      start: '2026-09-05T00:00:00.000Z',
      end: '2026-09-06T00:00:00.000Z',
    });

    expect(query.limit).toBe(10_000);
  });

  it('rejects inverted map and scientific filter ranges', () => {
    const result = EventQuerySchema.safeParse({
      start: '2026-09-05T00:00:00.000Z',
      end: '2026-09-06T00:00:00.000Z',
      minLat: 42,
      maxLat: 36,
      minMag: 4,
      maxMag: 2,
      minDepth: 30,
      maxDepth: 10,
    });

    expect(result.success).toBe(false);
  });
});
