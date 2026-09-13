import { describe, expect, it } from 'vitest';
import {
  detectSequenceCandidates,
  epicentralDistanceKm,
} from '@/lib/science/seismic-sequences';
import type { CatalogEvent } from '@/shared/schemas';

function event({
  id,
  hour,
  latitude = 39,
  longitude = 35,
  magnitude = 2,
}: {
  id: string;
  hour: number;
  latitude?: number;
  longitude?: number;
  magnitude?: number | null;
}): CatalogEvent {
  return {
    id: `AFAD:${id}`,
    source: 'AFAD',
    sourceEventId: id,
    originTime: new Date(Date.UTC(2026, 8, 12, hour)).toISOString(),
    latitude,
    longitude,
    depthKm: 8,
    magnitude,
    magnitudeType: 'ML',
    place: `${id}, Türkiye`,
    revisionCount: 1,
  };
}

describe('seismic sequence candidates', () => {
  it('groups nearby events and leaves spatial noise unclustered', () => {
    const result = detectSequenceCandidates([
      event({ id: 'a', hour: 1, magnitude: 2.1 }),
      event({ id: 'b', hour: 2, latitude: 39.04, magnitude: 3.2 }),
      event({ id: 'c', hour: 3, longitude: 35.05, magnitude: 1.8 }),
      event({ id: 'noise', hour: 2, latitude: 42, longitude: 40 }),
    ]);

    expect(result).toMatchObject({
      method: 'spatiotemporal-single-linkage',
      candidateCount: 1,
      clusteredEventCount: 3,
      unclusteredEventCount: 1,
    });
    expect(result.candidates[0]).toMatchObject({
      eventIds: ['AFAD:a', 'AFAD:b', 'AFAD:c'],
      eventCount: 3,
      maximumMagnitude: 3.2,
      largestEventId: 'AFAD:b',
      representativePlace: 'b, Türkiye',
      durationHours: 2,
    });
  });

  it('supports transparent single-linkage without calling it causation', () => {
    const events = [
      event({ id: 'west', hour: 1, longitude: 35 }),
      event({ id: 'middle', hour: 2, longitude: 35.25 }),
      event({ id: 'east', hour: 3, longitude: 35.5 }),
    ];
    expect(epicentralDistanceKm(events[0]!, events[2]!)).toBeGreaterThan(30);

    const result = detectSequenceCandidates(events);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.eventCount).toBe(3);
  });

  it('does not join events outside the temporal threshold', () => {
    const result = detectSequenceCandidates(
      [
        event({ id: 'a', hour: 0 }),
        event({ id: 'b', hour: 1 }),
        event({ id: 'c', hour: 12 }),
      ],
      {
        maxNeighborDistanceKm: 30,
        maxNeighborTimeHours: 6,
        minEvents: 3,
      },
    );

    expect(result.candidateCount).toBe(0);
    expect(result.unclusteredEventCount).toBe(3);
  });

  it('produces stable candidates regardless of input ordering', () => {
    const events = [
      event({ id: 'a', hour: 3 }),
      event({ id: 'b', hour: 1 }),
      event({ id: 'c', hour: 2 }),
    ];

    const forward = detectSequenceCandidates(events).candidates[0]!;
    const reverse = detectSequenceCandidates([...events].reverse())
      .candidates[0]!;

    expect(reverse.id).toBe(forward.id);
    expect(reverse.eventIds).toEqual(forward.eventIds);
    expect(reverse.centroid).toEqual(forward.centroid);
  });

  it('rejects unsafe or meaningless parameters', () => {
    expect(() =>
      detectSequenceCandidates([], {
        maxNeighborDistanceKm: 0,
        maxNeighborTimeHours: 24,
        minEvents: 3,
      }),
    ).toThrow(RangeError);
  });
});
