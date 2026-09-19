import type { SequenceObservation } from '@/lib/science/sequence-inspector';

export type SequencePlaybackSnapshot = {
  sequenceId: string;
  currentEventId: string;
  revealedEventIds: string[];
  currentIndex: number;
  totalEvents: number;
  playing: boolean;
};

export type SequencePlaybackPhase =
  | 'inactive'
  | 'upcoming'
  | 'revealed'
  | 'current';

/** Build an exact, bounded playback frame from chronological observations. */
export function sequencePlaybackSnapshot(
  sequenceId: string,
  observations: SequenceObservation[],
  requestedIndex: number,
  playing: boolean,
): SequencePlaybackSnapshot | null {
  if (observations.length === 0) return null;

  const currentIndex = Math.min(
    observations.length - 1,
    Math.max(0, Math.trunc(requestedIndex)),
  );
  const currentEventId = observations[currentIndex]!.event.id;

  return {
    sequenceId,
    currentEventId,
    revealedEventIds: observations
      .slice(0, currentIndex + 1)
      .map(({ event }) => event.id),
    currentIndex,
    totalEvents: observations.length,
    playing: playing && currentIndex < observations.length - 1,
  };
}

/** Keep short sequences legible and dense sequences bounded in duration. */
export function sequencePlaybackDelayMs(eventCount: number, speed = 1): number {
  const safeSpeed = Number.isFinite(speed) ? Math.max(0.25, speed) : 1;
  const transitions = Math.max(1, Math.trunc(eventCount) - 1);
  return Math.round(
    Math.min(1_000, Math.max(140, 10_000 / transitions / safeSpeed)),
  );
}

export function sequencePlaybackPhase(
  eventId: string,
  sequenceId: string,
  playback: SequencePlaybackSnapshot | null,
): SequencePlaybackPhase {
  if (!playback || playback.sequenceId !== sequenceId) return 'inactive';
  if (eventId === playback.currentEventId) return 'current';
  return playback.revealedEventIds.includes(eventId) ? 'revealed' : 'upcoming';
}
