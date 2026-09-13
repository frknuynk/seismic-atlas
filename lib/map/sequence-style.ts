import type { SeismicSequenceCandidate } from '@/lib/science/seismic-sequences';

export const SEQUENCE_COLORS = [
  '#2dd4bf',
  '#a78bfa',
  '#f472b6',
  '#fb923c',
  '#60a5fa',
  '#facc15',
] as const;

export type SequenceMembership = {
  sequenceId: string;
  color: string;
};

export function sequenceColor(index: number) {
  return SEQUENCE_COLORS[index % SEQUENCE_COLORS.length]!;
}

export function sequenceMembership(candidates: SeismicSequenceCandidate[]) {
  const membership = new Map<string, SequenceMembership>();
  for (const [index, candidate] of candidates.entries()) {
    const color = sequenceColor(index);
    for (const eventId of candidate.eventIds) {
      membership.set(eventId, { sequenceId: candidate.id, color });
    }
  }
  return membership;
}
