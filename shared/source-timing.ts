import type { SourceCode } from '@/shared/schemas';

export const SOURCE_SCHEDULES = {
  AFAD: {
    cadenceMinutes: 5,
    cronOffsetMinutes: 0,
    delayedAfterMinutes: 15,
    staleAfterMinutes: 60,
    schedulerOverdueAfterMinutes: 15,
  },
  USGS: {
    cadenceMinutes: 5,
    cronOffsetMinutes: 0,
    delayedAfterMinutes: 15,
    staleAfterMinutes: 60,
    schedulerOverdueAfterMinutes: 15,
  },
  EMSC: {
    cadenceMinutes: 5,
    cronOffsetMinutes: 0,
    delayedAfterMinutes: 15,
    staleAfterMinutes: 60,
    schedulerOverdueAfterMinutes: 15,
  },
  ISC: {
    cadenceMinutes: 1_440,
    cronOffsetMinutes: 0,
    delayedAfterMinutes: 1_500,
    staleAfterMinutes: 4_320,
    schedulerOverdueAfterMinutes: 1_500,
  },
  GCMT: {
    cadenceMinutes: 1_440,
    cronOffsetMinutes: 0,
    delayedAfterMinutes: 1_500,
    staleAfterMinutes: 4_320,
    schedulerOverdueAfterMinutes: 1_500,
  },
} as const;

export const AFAD_SCHEDULE = SOURCE_SCHEDULES.AFAD;

export type SourceFreshnessState =
  | 'fresh'
  | 'delayed'
  | 'stale'
  | 'unknown';
export type SchedulerRunState = 'running' | 'succeeded' | 'failed';

function nextScheduledRun(
  now: number,
  cadenceMinutes: number,
  offsetMinutes: number,
) {
  const cadenceMs = cadenceMinutes * 60_000;
  const offsetMs = offsetMinutes * 60_000;
  return Math.floor((now - offsetMs) / cadenceMs + 1) * cadenceMs + offsetMs;
}

export function sourceTiming(
  source: SourceCode,
  lastSuccessAt: number | null,
  now = Date.now(),
) {
  const schedule = SOURCE_SCHEDULES[source];
  const ageMs =
    lastSuccessAt === null ? null : Math.max(0, now - lastSuccessAt);
  const state: SourceFreshnessState =
    ageMs === null
      ? 'unknown'
      : ageMs > schedule.staleAfterMinutes * 60_000
        ? 'stale'
        : ageMs > schedule.delayedAfterMinutes * 60_000
          ? 'delayed'
          : 'fresh';

  return {
    freshness: {
      state,
      checkedAt: new Date(now).toISOString(),
      ageMinutes: ageMs === null ? null : Math.floor(ageMs / 60_000),
    },
    schedule: {
      cadenceMinutes: schedule.cadenceMinutes,
      delayedAfterMinutes: schedule.delayedAfterMinutes,
      staleAfterMinutes: schedule.staleAfterMinutes,
      nextScheduledAt: new Date(
        nextScheduledRun(
          now,
          schedule.cadenceMinutes,
          schedule.cronOffsetMinutes,
        ),
      ).toISOString(),
    },
  };
}

export function sourceSchedulerHealth(
  source: SourceCode,
  lastScheduledRun: {
    startedAt: number;
    completedAt: number | null;
    status: SchedulerRunState;
  } | null,
  now = Date.now(),
) {
  const schedule = SOURCE_SCHEDULES[source];
  const ageMs =
    lastScheduledRun === null
      ? null
      : Math.max(0, now - lastScheduledRun.startedAt);
  const state =
    lastScheduledRun === null
      ? ('missing' as const)
      : ageMs !== null &&
          ageMs > schedule.schedulerOverdueAfterMinutes * 60_000
        ? ('overdue' as const)
        : lastScheduledRun.status === 'running'
          ? ('running' as const)
          : ('healthy' as const);

  return {
    state,
    checkedAt: new Date(now).toISOString(),
    overdueAfterMinutes: schedule.schedulerOverdueAfterMinutes,
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

export function afadSourceTiming(
  lastSuccessAt: number | null,
  now = Date.now(),
) {
  return sourceTiming('AFAD', lastSuccessAt, now);
}

export function afadSchedulerHealth(
  lastScheduledRun: {
    startedAt: number;
    completedAt: number | null;
    status: SchedulerRunState;
  } | null,
  now = Date.now(),
) {
  return sourceSchedulerHealth('AFAD', lastScheduledRun, now);
}
