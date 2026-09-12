import { describe, expect, it } from 'vitest';
import { planSourceCircuitFailure } from '@/worker/ingestion/source-control';
import { AfadSourceError } from '@/worker/sources/afad';

const now = Date.parse('2026-09-12T12:00:00.000Z');

describe('AFAD source circuit breaker', () => {
  it('opens for 24 hours after a forbidden response', () => {
    expect(
      planSourceCircuitFailure({
        error: new AfadSourceError('AFAD_HTTP_403', 'Forbidden', 1),
        previousFailures: 0,
        now,
      }),
    ).toEqual({
      consecutiveFailures: 1,
      circuitOpenUntil: now + 24 * 60 * 60_000,
      errorCode: 'AFAD_HTTP_403',
    });
  });

  it('uses at least a one-hour cooldown after rate limiting', () => {
    expect(
      planSourceCircuitFailure({
        error: new AfadSourceError(
          'AFAD_HTTP_429',
          'Rate limited',
          1,
          [],
          0,
          2 * 60 * 60_000,
        ),
        previousFailures: 1,
        now,
      }),
    ).toEqual({
      consecutiveFailures: 2,
      circuitOpenUntil: now + 2 * 60 * 60_000,
      errorCode: 'AFAD_HTTP_429',
    });
  });

  it('opens after three consecutive upstream failures', () => {
    expect(
      planSourceCircuitFailure({
        error: new AfadSourceError('AFAD_TIMEOUT', 'Timed out', 3),
        previousFailures: 2,
        now,
      }),
    ).toEqual({
      consecutiveFailures: 3,
      circuitOpenUntil: now + 60 * 60_000,
      errorCode: 'AFAD_TIMEOUT',
    });
  });

  it('does not trip the upstream circuit for local completeness failures', () => {
    expect(
      planSourceCircuitFailure({
        error: new AfadSourceError(
          'AFAD_WINDOW_SATURATED',
          'Window saturated',
          1,
        ),
        previousFailures: 0,
        now,
      }),
    ).toBeNull();
  });
});
