import { describe, expect, it } from 'vitest';
import {
  buildSequenceInspector,
  cumulativePlotObservations,
  magnitudePlotObservations,
} from '@/lib/science/sequence-inspector';
import type { SeismicSequenceCandidate } from '@/lib/science/seismic-sequences';
import type { CatalogEvent } from '@/shared/schemas';

function event(
  id: string,
  hour: number,
  magnitude: number | null,
): CatalogEvent {
  return {
    id: `AFAD:${id}`,
    source: 'AFAD',
    sourceEventId: id,
    originTime: new Date(Date.UTC(2026, 8, 12, hour)).toISOString(),
    latitude: 39,
    longitude: 35,
    depthKm: id === 'b' ? null : 8,
    magnitude,
    magnitudeType: magnitude === null ? null : 'ML',
    place: 'Türkiye',
    revisionCount: 1,
  };
}

const candidate = {
  id: 'sequence-test',
  eventIds: ['AFAD:c', 'AFAD:b', 'AFAD:a'],
  eventCount: 3,
} as SeismicSequenceCandidate;

describe('sequence inspector model', () => {
  it('orders member events and keeps missing magnitudes out of the magnitude plot', () => {
    const result = buildSequenceInspector(candidate, [
      event('c', 3, 2.1),
      event('a', 1, 1.3),
      event('b', 2, null),
      event('unrelated', 0, 5.2),
    ]);

    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(result.observations.map(({ event }) => event.id)).toEqual([
      'AFAD:a',
      'AFAD:b',
      'AFAD:c',
    ]);
    expect(
      result.observations.map(({ cumulativeCount }) => cumulativeCount),
    ).toEqual([1, 2, 3]);
    expect(result.magnitudeObservations.map(({ event }) => event.id)).toEqual([
      'AFAD:a',
      'AFAD:c',
    ]);
    expect(result.missingMagnitudeCount).toBe(1);
    expect(result.missingDepthCount).toBe(1);
  });

  it('refuses an incomplete candidate instead of presenting partial charts', () => {
    expect(buildSequenceInspector(candidate, [event('a', 1, 1.3)])).toEqual({
      complete: false,
      missingEventIds: ['AFAD:c', 'AFAD:b'],
    });
  });

  it('uses event IDs to order equal-time observations deterministically', () => {
    const result = buildSequenceInspector(candidate, [
      event('c', 1, 2),
      event('a', 1, 2),
      event('b', 1, 2),
    ]);
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(result.observations.map(({ event }) => event.id)).toEqual([
      'AFAD:a',
      'AFAD:b',
      'AFAD:c',
    ]);
  });

  it('bounds dense plots without dropping the cumulative endpoint or magnitude extremes', () => {
    const observations = Array.from({ length: 1_200 }, (_, index) => ({
      event: event(
        String(index),
        1,
        index === 447 ? 7 : index === 853 ? 0.2 : 2,
      ),
      timeMs: index,
      cumulativeCount: index + 1,
    }));
    const magnitudePlot = magnitudePlotObservations(observations);
    const cumulativePlot = cumulativePlotObservations(observations);

    expect(magnitudePlot.length).toBeLessThanOrEqual(600);
    expect(magnitudePlot.some(({ event }) => event.magnitude === 7)).toBe(true);
    expect(magnitudePlot.some(({ event }) => event.magnitude === 0.2)).toBe(
      true,
    );
    expect(cumulativePlot.length).toBeLessThanOrEqual(600);
    expect(cumulativePlot.at(-1)?.cumulativeCount).toBe(1_200);
  });
});
