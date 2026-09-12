import { env } from 'cloudflare:workers';
import { getD1 } from '@/db';
import { AfadSyncRequestSchema } from '@/shared/schemas';
import { runAfadSync } from '@/worker/ingestion/afad';

function isAuthorized(request: Request) {
  const configuredToken = env.AFAD_SYNC_TOKEN;
  const url = new URL(request.url);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  if (!configuredToken) return isLocal;
  return request.headers.get('authorization') === `Bearer ${configuredToken}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Valid sync credentials required.',
        },
      },
      { status: 401 },
    );
  }

  let body: unknown = { mode: 'sync' };
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return Response.json(
      {
        error: {
          code: 'INVALID_SYNC_REQUEST',
          message: 'Request body must be valid JSON.',
        },
      },
      { status: 400 },
    );
  }

  const parsed = AfadSyncRequestSchema.safeParse(body);
  if (
    !parsed.success ||
    (parsed.data.mode === 'backfill' &&
      Date.parse(parsed.data.end) > Date.now())
  ) {
    return Response.json(
      {
        error: {
          code: 'INVALID_SYNC_REQUEST',
          message:
            'Use sync mode or a past-facing backfill window of at most 24 hours.',
          issues: parsed.success ? [] : parsed.error.issues,
        },
      },
      { status: 400 },
    );
  }

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
    return Response.json({ source: 'AFAD', ...result });
  } catch (error) {
    console.error('AFAD synchronization failed', error);
    return Response.json(
      {
        error: {
          code: 'AFAD_SYNC_FAILED',
          message:
            'AFAD synchronization failed; stored catalog data was preserved.',
        },
      },
      { status: 502 },
    );
  }
}
