export const AFAD_SCHEDULE = {
  cadenceMinutes: 60,
  cronMinute: 7,
  delayedAfterMinutes: 75,
  staleAfterMinutes: 180,
  schedulerOverdueAfterMinutes: 120,
} as const;

export type SourceFreshnessState =
  | 'fresh'
  | 'delayed'
  | 'stale'
  | 'unknown';

export type SchedulerRunState = 'running' | 'succeeded' | 'failed';

function nextHourlyRun(now: number, minute: number) {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(minute);
  if (next.getTime() <= now) next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime();
}

export function afadSourceTiming(
  lastSuccessAt: number | null,
  now = Date.now(),
) {
  const ageMs =
    lastSuccessAt === null ? null : Math.max(0, now - lastSuccessAt);
  const delayedAfterMs = AFAD_SCHEDULE.delayedAfterMinutes * 60_000;
  const staleAfterMs = AFAD_SCHEDULE.staleAfterMinutes * 60_000;
  const state: SourceFreshnessState =
    ageMs === null
      ? 'unknown'
      : ageMs > staleAfterMs
        ? 'stale'
        : ageMs > delayedAfterMs
          ? 'delayed'
          : 'fresh';

  return {
    freshness: {
      state,
      checkedAt: new Date(now).toISOString(),
      ageMinutes: ageMs === null ? null : Math.floor(ageMs / 60_000),
    },
    schedule: {
      cadenceMinutes: AFAD_SCHEDULE.cadenceMinutes,
      delayedAfterMinutes: AFAD_SCHEDULE.delayedAfterMinutes,
      staleAfterMinutes: AFAD_SCHEDULE.staleAfterMinutes,
      nextScheduledAt: new Date(
        nextHourlyRun(now, AFAD_SCHEDULE.cronMinute),
      ).toISOString(),
    },
  };
}

export function afadSchedulerHealth(
  lastScheduledRun: {
    startedAt: number;
    completedAt: number | null;
    status: SchedulerRunState;
  } | null,
  now = Date.now(),
) {
  const ageMs =
    lastScheduledRun === null
      ? null
      : Math.max(0, now - lastScheduledRun.startedAt);
  const overdueAfterMs =
    AFAD_SCHEDULE.schedulerOverdueAfterMinutes * 60_000;
  const state =
    lastScheduledRun === null
      ? ('missing' as const)
      : ageMs !== null && ageMs > overdueAfterMs
        ? ('overdue' as const)
        : lastScheduledRun.status === 'running'
          ? ('running' as const)
          : ('healthy' as const);

  return {
    state,
    checkedAt: new Date(now).toISOString(),
    overdueAfterMinutes: AFAD_SCHEDULE.schedulerOverdueAfterMinutes,
    lastScheduledAt:
      lastScheduledRun === null
        ? null
        : new Date(lastScheduledRun.startedAt).toISOString(),
    lastScheduledCompletedAt:
      lastScheduledRun?.completedAt === null || !lastScheduledRun
        ? null
        : new Date(lastScheduledRun.completedAt).toISOString(),
    lastScheduledStatus: lastScheduledRun?.status ?? null,
  };
}
