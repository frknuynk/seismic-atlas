import { describe, expect, it } from 'vitest';
import {
  SEQUENCE_COLORS,
  sequenceColor,
  sequenceMembership,
} from '@/lib/map/sequence-style';
import type { SeismicSequenceCandidate } from '@/lib/science/seismic-sequences';

function candidate(id: string, eventIds: string[]): SeismicSequenceCandidate {
  return {
    id,
    eventIds,
    eventCount: eventIds.length,
    startTime: '2026-09-12T00:00:00.000Z',
    endTime: '2026-09-12T01:00:00.000Z',
    durationHours: 1,
    centroid: { latitude: 39, longitude: 35 },
    spatialRadiusKm: 5,
    maximumMagnitude: 2,
    largestEventId: eventIds[0]!,
    representativePlace: 'Türkiye',
  };
}

describe('sequence map style', () => {
  it('assigns one stable candidate color to every member event', () => {
    const membership = sequenceMembership([
      candidate('sequence-a', ['AFAD:1', 'AFAD:2']),
      candidate('sequence-b', ['AFAD:3']),
    ]);

    expect(membership.get('AFAD:1')).toEqual({
      sequenceId: 'sequence-a',
      color: SEQUENCE_COLORS[0],
    });
    expect(membership.get('AFAD:2')).toEqual(membership.get('AFAD:1'));
    expect(membership.get('AFAD:3')?.color).toBe(SEQUENCE_COLORS[1]);
  });

  it('cycles the palette deterministically', () => {
    expect(sequenceColor(SEQUENCE_COLORS.length)).toBe(SEQUENCE_COLORS[0]);
  });
});
