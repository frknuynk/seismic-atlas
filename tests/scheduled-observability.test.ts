import { afterEach, describe, expect, it, vi } from 'vitest';
import { runObservedScheduledAfadSync } from '@/worker/scheduled';

function parseLog(call: unknown[] | undefined) {
  return JSON.parse(String(call?.[0]));
}

describe('scheduled AFAD observability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records correlated start and skipped completion events', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runSync = vi.fn().mockResolvedValue({
      runId: 'run-id',
      status: 'skipped',
      reason: 'sync_in_progress',
    });
    const clock = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_075);

    await expect(
      runObservedScheduledAfadSync({} as D1Database, {
        scheduledTime: Date.UTC(2026, 8, 19, 13, 7),
        correlationId: 'correlation-id',
        clock,
        runSync,
      }),
    ).resolves.toMatchObject({ status: 'skipped' });

    expect(runSync).toHaveBeenCalledWith({}, { trigger: 'scheduled' });
    expect(parseLog(consoleInfo.mock.calls[0])).toMatchObject({
      event: 'cron.afad_sync.started',
      correlationId: 'correlation-id',
      scheduledTime: '2026-09-19T13:07:00.000Z',
    });
    expect(parseLog(consoleWarn.mock.calls[0])).toMatchObject({
      event: 'cron.afad_sync.completed',
      correlationId: 'correlation-id',
      runId: 'run-id',
      status: 'skipped',
      reason: 'sync_in_progress',
      durationMs: 75,
    });
  });

  it('records sanitized cron failures and rethrows them', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const failure = Object.assign(new Error('AFAD unavailable'), {
      code: 'AFAD_UNAVAILABLE',
    });
    const runSync = vi.fn().mockRejectedValue(failure);
    const clock = vi.fn().mockReturnValueOnce(2_000).mockReturnValueOnce(2_125);

    await expect(
      runObservedScheduledAfadSync({} as D1Database, {
        scheduledTime: Date.UTC(2026, 8, 19, 13, 7),
        correlationId: 'correlation-id',
        clock,
        runSync,
      }),
    ).rejects.toBe(failure);

    expect(parseLog(consoleError.mock.calls[0])).toMatchObject({
      event: 'cron.afad_sync.failed',
      correlationId: 'correlation-id',
      durationMs: 125,
      error: {
        name: 'Error',
        message: 'AFAD unavailable',
        code: 'AFAD_UNAVAILABLE',
      },
    });
  });
});
