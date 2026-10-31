import { describe, expect, it } from 'vitest';
import {
  afadSchedulerHealth,
  afadSourceTiming,
} from '@/shared/source-timing';

const NOW = Date.parse('2026-09-19T11:26:00.000Z');

describe('AFAD source timing', () => {
  it('reports the five-minute schedule and next run', () => {
    const timing = afadSourceTiming(NOW - 10 * 60_000, NOW);

    expect(timing.freshness).toEqual({
      state: 'fresh',
      checkedAt: '2026-09-19T11:26:00.000Z',
      ageMinutes: 10,
    });
    expect(timing.schedule).toEqual({
      cadenceMinutes: 5,
      delayedAfterMinutes: 15,
      staleAfterMinutes: 60,
      nextScheduledAt: '2026-09-19T11:30:00.000Z',
    });
  });

  it.each([
    [15, 'fresh'],
    [16, 'delayed'],
    [60, 'delayed'],
    [61, 'stale'],
  ] as const)('classifies %i minute-old data as %s', (minutes, state) => {
    expect(
      afadSourceTiming(NOW - minutes * 60_000, NOW).freshness.state,
    ).toBe(state);
  });

  it('reports unknown freshness before the first successful sync', () => {
    expect(afadSourceTiming(null, NOW).freshness).toEqual({
      state: 'unknown',
      checkedAt: '2026-09-19T11:26:00.000Z',
      ageMinutes: null,
    });
  });
});

describe('AFAD scheduler watchdog', () => {
  it('does not let the absence of scheduled runs look healthy', () => {
    expect(afadSchedulerHealth(null, NOW)).toEqual({
      state: 'missing',
      checkedAt: '2026-09-19T11:26:00.000Z',
      overdueAfterMinutes: 15,
      lastScheduledAt: null,
      lastScheduledCompletedAt: null,
      lastScheduledStatus: null,
    });
  });

  it.each([
    [14, 'succeeded', 'healthy'],
    [14, 'failed', 'healthy'],
    [14, 'running', 'running'],
    [16, 'succeeded', 'overdue'],
    [16, 'running', 'overdue'],
  ] as const)(
    'classifies a %i minute-old %s scheduled run as %s',
    (minutes, status, state) => {
      expect(
        afadSchedulerHealth(
          {
            startedAt: NOW - minutes * 60_000,
            completedAt: status === 'running' ? null : NOW - 13 * 60_000,
            status,
          },
          NOW,
        ).state,
      ).toBe(state);
    },
  );
});
