const MIN_INCREMENTAL_WINDOW_MS = 15 * 60_000;
const OVERLAP_MS = 5 * 60_000;
const MAX_GAP_RECOVERY_MS = 24 * 60 * 60_000;
const FULL_RECONCILE_MS = 7 * 24 * 60 * 60_000;
const RECONCILE_INTERVAL_MS = 24 * 60 * 60_000;
export const MAX_BACKFILL_WINDOW_MS = 24 * 60 * 60_000;

export type AfadWindowKind =
  | 'manual'
  | 'bootstrap'
  | 'incremental'
  | 'reconcile'
  | 'backfill';

export type AfadIngestionCursor = {
  lastSuccessWindowEnd: number | null;
  lastFullReconcileAt: number | null;
} | null;

export function planAfadBackfillWindow({
  start,
  end,
  now,
}: {
  start: Date;
  end: Date;
  now: Date;
}) {
  const startMs = start.valueOf();
  const endMs = end.valueOf();
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs >= endMs ||
    endMs > now.valueOf() ||
    endMs - startMs > MAX_BACKFILL_WINDOW_MS
  ) {
    throw new RangeError(
      'Backfill requires a past-facing window of at most 24 hours.',
    );
  }

  return {
    start,
    end,
    kind: 'backfill' as const,
    fullReconcile: false,
  };
}

export function planAfadSyncWindow({
  now,
  trigger,
  cursor,
  requestedWindowMinutes,
}: {
  now: Date;
  trigger: 'manual' | 'scheduled';
  cursor: AfadIngestionCursor;
  requestedWindowMinutes?: number;
}) {
  const endMs = now.valueOf();

  if (trigger === 'manual') {
    const requestedMs =
      Math.max(
        15,
        Math.min(7 * 24 * 60, requestedWindowMinutes ?? 7 * 24 * 60),
      ) * 60_000;
    return {
      start: new Date(endMs - requestedMs),
      end: now,
      kind: 'manual' as const,
      fullReconcile: true,
    };
  }

  if (!cursor?.lastSuccessWindowEnd) {
    return {
      start: new Date(endMs - FULL_RECONCILE_MS),
      end: now,
      kind: 'bootstrap' as const,
      fullReconcile: true,
    };
  }

  const fullReconcileDue =
    cursor.lastFullReconcileAt === null ||
    endMs - cursor.lastFullReconcileAt >= RECONCILE_INTERVAL_MS;
  if (fullReconcileDue) {
    return {
      start: new Date(endMs - FULL_RECONCILE_MS),
      end: now,
      kind: 'reconcile' as const,
      fullReconcile: true,
    };
  }

  const minimumStart = endMs - MIN_INCREMENTAL_WINDOW_MS;
  const cursorStart = cursor.lastSuccessWindowEnd - OVERLAP_MS;
  const boundedStart = Math.max(
    endMs - MAX_GAP_RECOVERY_MS,
    Math.min(minimumStart, cursorStart),
  );

  return {
    start: new Date(boundedStart),
    end: now,
    kind: 'incremental' as const,
    fullReconcile: false,
  };
}
