import { env } from 'cloudflare:workers';
import { getD1 } from '@/db';
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
      { error: { code: 'UNAUTHORIZED', message: 'Valid sync credentials required.' } },
      { status: 401 },
    );
  }

  try {
    const result = await runAfadSync(getD1());
    return Response.json({ source: 'AFAD', status: 'ok', ...result });
  } catch (error) {
    console.error('AFAD synchronization failed', error);
    return Response.json(
      {
        error: {
          code: 'AFAD_SYNC_FAILED',
          message: 'AFAD synchronization failed; stored catalog data was preserved.',
        },
      },
      { status: 502 },
    );
  }
}
