import { describe, expect, it } from 'vitest';
import { planAfadSyncWindow } from '@/worker/ingestion/window';

const now = new Date('2026-09-06T20:00:00.000Z');

describe('AFAD synchronization window planning', () => {
  it('uses a seven-day window for manual reconciliation', () => {
    const window = planAfadSyncWindow({
      now,
      trigger: 'manual',
      cursor: null,
    });

    expect(window.kind).toBe('manual');
    expect(window.fullReconcile).toBe(true);
    expect(window.start.toISOString()).toBe('2026-08-30T20:00:00.000Z');
  });

  it('bootstraps a new scheduled source with seven days of data', () => {
    const window = planAfadSyncWindow({
      now,
      trigger: 'scheduled',
      cursor: null,
    });

    expect(window.kind).toBe('bootstrap');
    expect(window.start.toISOString()).toBe('2026-08-30T20:00:00.000Z');
  });

  it('keeps a fifteen-minute minimum incremental overlap', () => {
    const window = planAfadSyncWindow({
      now,
      trigger: 'scheduled',
      cursor: {
        lastSuccessWindowEnd: Date.parse('2026-09-06T19:52:00.000Z'),
        lastFullReconcileAt: Date.parse('2026-09-06T12:00:00.000Z'),
      },
    });

    expect(window.kind).toBe('incremental');
    expect(window.start.toISOString()).toBe('2026-09-06T19:45:00.000Z');
  });

  it('recovers a missed scheduler gap with a five-minute overlap', () => {
    const window = planAfadSyncWindow({
      now,
      trigger: 'scheduled',
      cursor: {
        lastSuccessWindowEnd: Date.parse('2026-09-06T14:00:00.000Z'),
        lastFullReconcileAt: Date.parse('2026-09-06T12:00:00.000Z'),
      },
    });

    expect(window.start.toISOString()).toBe('2026-09-06T13:55:00.000Z');
  });

  it('bounds gap recovery to one day', () => {
    const window = planAfadSyncWindow({
      now,
      trigger: 'scheduled',
      cursor: {
        lastSuccessWindowEnd: Date.parse('2026-09-03T20:00:00.000Z'),
        lastFullReconcileAt: Date.parse('2026-09-06T12:00:00.000Z'),
      },
    });

    expect(window.start.toISOString()).toBe('2026-09-05T20:00:00.000Z');
  });

  it('runs a daily full reconciliation to catch source revisions', () => {
    const window = planAfadSyncWindow({
      now,
      trigger: 'scheduled',
      cursor: {
        lastSuccessWindowEnd: Date.parse('2026-09-06T19:59:00.000Z'),
        lastFullReconcileAt: Date.parse('2026-09-05T18:00:00.000Z'),
      },
    });

    expect(window.kind).toBe('reconcile');
    expect(window.fullReconcile).toBe(true);
    expect(window.start.toISOString()).toBe('2026-08-30T20:00:00.000Z');
  });
});
