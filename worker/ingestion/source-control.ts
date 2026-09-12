import { AfadSourceError } from '@/worker/sources/afad';

const FORBIDDEN_COOLDOWN_MS = 24 * 60 * 60_000;
const RATE_LIMIT_COOLDOWN_MS = 60 * 60_000;
const FAILURE_COOLDOWN_MS = 60 * 60_000;
const FAILURE_THRESHOLD = 3;

type SourceRequestControlRow = {
  consecutive_failures: number;
  circuit_open_until: number | null;
  last_error_code: string | null;
};

export type SourceCircuitGate =
  | { allowed: true; consecutiveFailures: number }
  | {
      allowed: false;
      consecutiveFailures: number;
      retryAt: number;
      reason: string | null;
    };

export type SourceCircuitFailure = {
  consecutiveFailures: number;
  circuitOpenUntil: number | null;
  errorCode: string;
};

export async function sourceCircuitGate(
  db: D1Database,
  source: string,
  now: number,
): Promise<SourceCircuitGate> {
  const row = await db
    .prepare(
      `SELECT consecutive_failures, circuit_open_until, last_error_code
      FROM source_request_control
      WHERE source = ?`,
    )
    .bind(source)
    .first<SourceRequestControlRow>();

  if (row?.circuit_open_until && row.circuit_open_until > now) {
    return {
      allowed: false,
      consecutiveFailures: row.consecutive_failures,
      retryAt: row.circuit_open_until,
      reason: row.last_error_code,
    };
  }

  return {
    allowed: true,
    consecutiveFailures: row?.consecutive_failures ?? 0,
  };
}

function isUpstreamFailure(code: string) {
  return (
    code === 'AFAD_TIMEOUT' ||
    code === 'AFAD_NETWORK_ERROR' ||
    code === 'AFAD_INVALID_JSON' ||
    code === 'AFAD_INVALID_PAYLOAD' ||
    /^AFAD_HTTP_(408|429|5\d\d)$/.test(code)
  );
}

export function planSourceCircuitFailure({
  error,
  previousFailures,
  now,
}: {
  error: AfadSourceError;
  previousFailures: number;
  now: number;
}): SourceCircuitFailure | null {
  const nextFailures = previousFailures + 1;

  if (error.code === 'AFAD_HTTP_403') {
    return {
      consecutiveFailures: nextFailures,
      circuitOpenUntil: now + FORBIDDEN_COOLDOWN_MS,
      errorCode: error.code,
    };
  }

  if (error.code === 'AFAD_HTTP_429') {
    return {
      consecutiveFailures: nextFailures,
      circuitOpenUntil:
        now + Math.max(RATE_LIMIT_COOLDOWN_MS, error.retryAfterMs ?? 0),
      errorCode: error.code,
    };
  }

  if (!isUpstreamFailure(error.code)) return null;

  return {
    consecutiveFailures: nextFailures,
    circuitOpenUntil:
      error.retryAfterMs !== null
        ? now + error.retryAfterMs
        : nextFailures >= FAILURE_THRESHOLD
          ? now + FAILURE_COOLDOWN_MS
          : null,
    errorCode: error.code,
  };
}

export function sourceCircuitSuccessStatement(
  db: D1Database,
  source: string,
  now: number,
) {
  return db
    .prepare(
      `INSERT INTO source_request_control (
        source, consecutive_failures, circuit_open_until, last_error_code,
        updated_at
      ) VALUES (?, 0, NULL, NULL, ?)
      ON CONFLICT(source) DO UPDATE SET
        consecutive_failures = 0,
        circuit_open_until = NULL,
        last_error_code = NULL,
        updated_at = excluded.updated_at`,
    )
    .bind(source, now);
}

export function sourceCircuitFailureStatement(
  db: D1Database,
  source: string,
  failure: SourceCircuitFailure,
  now: number,
) {
  return db
    .prepare(
      `INSERT INTO source_request_control (
        source, consecutive_failures, circuit_open_until, last_error_code,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        consecutive_failures = excluded.consecutive_failures,
        circuit_open_until = excluded.circuit_open_until,
        last_error_code = excluded.last_error_code,
        updated_at = excluded.updated_at`,
    )
    .bind(
      source,
      failure.consecutiveFailures,
      failure.circuitOpenUntil,
      failure.errorCode,
      now,
    );
}
