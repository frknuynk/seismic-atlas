import { env } from 'cloudflare:workers';
import { getD1 } from '@/db';
import { AfadSyncRequestSchema } from '@/shared/schemas';
import { runAfadSync } from '@/worker/ingestion/afad';
import {
  apiErrorResponse,
  logApiError,
  logEvent,
  requestIdFrom,
} from '@/worker/observability';
import {
  isManualSyncRateLimited,
  manualSyncRateLimitedResponse,
} from '@/worker/security';

function isAuthorized(request: Request) {
  const configuredToken = env.AFAD_SYNC_TOKEN;
  const url = new URL(request.url);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  if (!configuredToken) return isLocal;
  return request.headers.get('authorization') === `Bearer ${configuredToken}`;
}

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);

  if (!isAuthorized(request)) {
    return apiErrorResponse(request, {
      code: 'UNAUTHORIZED',
      message: 'Valid sync credentials required.',
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (await isManualSyncRateLimited(env.MANUAL_SYNC_RATE_LIMIT, requestId)) {
    return manualSyncRateLimitedResponse(request);
  }

  let body: unknown = { mode: 'sync' };
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return apiErrorResponse(request, {
      code: 'INVALID_SYNC_REQUEST',
      message: 'Request body must be valid JSON.',
      status: 400,
    });
  }

  const parsed = AfadSyncRequestSchema.safeParse(body);
  if (
    !parsed.success ||
    (parsed.data.mode === 'backfill' &&
      Date.parse(parsed.data.end) > Date.now())
  ) {
    return apiErrorResponse(request, {
      code: 'INVALID_SYNC_REQUEST',
      message:
        'Use sync mode or a past-facing backfill window of at most 24 hours.',
      status: 400,
      details: { issues: parsed.success ? [] : parsed.error.issues },
    });
  }

  const startedAt = Date.now();
  logEvent('info', 'sync.afad.started', {
    requestId,
    mode: parsed.data.mode,
  });

  try {
    const result = await runAfadSync(
      getD1(),
      parsed.data.mode === 'backfill'
        ? {
            backfillWindow: {
              start: new Date(parsed.data.start),
              end: new Date(parsed.data.end),
            },
          }
        : { windowMinutes: parsed.data.windowMinutes },
    );
    logEvent(
      result.status === 'succeeded' ? 'info' : 'warn',
      'sync.afad.completed',
      {
        requestId,
        runId: result.runId,
        status: result.status,
        durationMs: Math.max(0, Date.now() - startedAt),
        reason: 'reason' in result ? result.reason : null,
      },
    );
    return Response.json({ source: 'AFAD', ...result });
  } catch (error) {
    logApiError(request, 'sync.afad.failed', error, {
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    return apiErrorResponse(request, {
      code: 'AFAD_SYNC_FAILED',
      message:
        'AFAD synchronization failed; stored catalog data was preserved.',
      status: 502,
    });
  }
}
