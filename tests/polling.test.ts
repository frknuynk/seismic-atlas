import { describe, expect, it } from 'vitest';
import {
  CATALOG_QUALITY_POLL_INTERVAL_MS,
  EVENT_POLL_INTERVAL_MS,
  shouldRunScheduledPoll,
} from '@/lib/polling';

describe('free-tier polling policy', () => {
  it('uses conservative event and quality intervals', () => {
    expect(EVENT_POLL_INTERVAL_MS).toBe(5 * 60_000);
    expect(CATALOG_QUALITY_POLL_INTERVAL_MS).toBe(15 * 60_000);
  });

  it('never polls while the page is hidden', () => {
    expect(shouldRunScheduledPoll('hidden', null, 10_000, 1_000)).toBe(
      false,
    );
    expect(shouldRunScheduledPoll('hidden', 0, 10_000, 1_000)).toBe(false);
  });

  it('polls on first visibility and only after the interval thereafter', () => {
    expect(shouldRunScheduledPoll('visible', null, 10_000, 5_000)).toBe(true);
    expect(shouldRunScheduledPoll('visible', 8_000, 10_000, 5_000)).toBe(
      false,
    );
    expect(shouldRunScheduledPoll('visible', 5_000, 10_000, 5_000)).toBe(
      true,
    );
  });
});
