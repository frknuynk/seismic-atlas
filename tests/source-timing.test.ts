import { describe, expect, it } from 'vitest';
import {
  afadSchedulerHealth,
  afadSourceTiming,
} from '@/shared/source-timing';

const NOW = Date.parse('2026-09-19T11:26:00.000Z');

describe('AFAD source timing', () => {
  it('reports the hourly schedule and next minute-seven run', () => {
    const timing = afadSourceTiming(NOW - 30 * 60_000, NOW);

    expect(timing.freshness).toEqual({
      state: 'fresh',
      checkedAt: '2026-09-19T11:26:00.000Z',
      ageMinutes: 30,
    });
    expect(timing.schedule).toEqual({
      cadenceMinutes: 60,
      delayedAfterMinutes: 75,
      staleAfterMinutes: 180,
      nextScheduledAt: '2026-09-19T12:07:00.000Z',
    });
  });

  it.each([
    [75, 'fresh'],
    [76, 'delayed'],
    [180, 'delayed'],
    [181, 'stale'],
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
      overdueAfterMinutes: 120,
      lastScheduledAt: null,
      lastScheduledCompletedAt: null,
      lastScheduledStatus: null,
    });
  });

  it.each([
    [119, 'succeeded', 'healthy'],
    [119, 'failed', 'healthy'],
    [119, 'running', 'running'],
    [121, 'succeeded', 'overdue'],
    [121, 'running', 'overdue'],
  ] as const)(
    'classifies a %i minute-old %s scheduled run as %s',
    (minutes, status, state) => {
      expect(
        afadSchedulerHealth(
          {
            startedAt: NOW - minutes * 60_000,
            completedAt: status === 'running' ? null : NOW - 118 * 60_000,
            status,
          },
          NOW,
        ).state,
      ).toBe(state);
    },
  );
});
