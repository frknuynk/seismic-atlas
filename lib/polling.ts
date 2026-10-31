export const EVENT_POLL_INTERVAL_MS = 5 * 60_000;
export const CATALOG_QUALITY_POLL_INTERVAL_MS = 15 * 60_000;

export function shouldRunScheduledPoll(
  visibilityState: DocumentVisibilityState,
  lastStartedAt: number | null,
  now: number,
  intervalMs: number,
) {
  if (visibilityState === 'hidden') return false;
  return lastStartedAt === null || now - lastStartedAt >= intervalMs;
}
