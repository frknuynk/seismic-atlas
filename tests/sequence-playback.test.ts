import { describe, expect, it } from 'vitest';
import {
  sequencePlaybackDelayMs,
  sequencePlaybackPhase,
  sequencePlaybackSnapshot,
} from '@/lib/science/sequence-playback';
import type { SequenceObservation } from '@/lib/science/sequence-inspector';
import type { CatalogEvent } from '@/shared/schemas';

function observation(id: string, index: number): SequenceObservation {
  return {
    event: { id: `AFAD:${id}` } as CatalogEvent,
    timeMs: index,
    cumulativeCount: index + 1,
  };
}

const observations = [
  observation('a', 0),
  observation('b', 1),
  observation('c', 2),
];

describe('sequence playback', () => {
  it('builds an exact cumulative frame and stops playing at the endpoint', () => {
    expect(
      sequencePlaybackSnapshot('sequence-1', observations, 1, true),
    ).toEqual({
      sequenceId: 'sequence-1',
      currentEventId: 'AFAD:b',
      revealedEventIds: ['AFAD:a', 'AFAD:b'],
      currentIndex: 1,
      totalEvents: 3,
      playing: true,
    });
    expect(
      sequencePlaybackSnapshot('sequence-1', observations, 99, true)?.playing,
    ).toBe(false);
    expect(sequencePlaybackSnapshot('sequence-1', [], 0, true)).toBeNull();
  });

  it('classifies map members without affecting unrelated sequences', () => {
    const frame = sequencePlaybackSnapshot('sequence-1', observations, 1, true);
    expect(sequencePlaybackPhase('AFAD:a', 'sequence-1', frame)).toBe(
      'revealed',
    );
    expect(sequencePlaybackPhase('AFAD:b', 'sequence-1', frame)).toBe(
      'current',
    );
    expect(sequencePlaybackPhase('AFAD:c', 'sequence-1', frame)).toBe(
      'upcoming',
    );
    expect(sequencePlaybackPhase('AFAD:a', 'sequence-2', frame)).toBe(
      'inactive',
    );
  });

  it('keeps playback duration bounded for sparse and dense candidates', () => {
    expect(sequencePlaybackDelayMs(3)).toBe(1_000);
    expect(sequencePlaybackDelayMs(101)).toBe(140);
    expect(sequencePlaybackDelayMs(101, 2)).toBe(140);
    expect(sequencePlaybackDelayMs(11, 2)).toBe(500);
  });
});
