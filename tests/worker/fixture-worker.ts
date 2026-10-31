import { withSecurityHeaders } from '@/worker/security';

const fixtureWorker = {
  async fetch(request: Request, env: Cloudflare.Env) {
    const url = new URL(request.url);
    if (url.pathname === '/test/event-count') {
      const row = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM source_events',
      ).first<{ count: number }>();
      return withSecurityHeaders(
        request,
        Response.json(
          { count: Number(row?.count ?? 0) },
          {
            headers: { 'Cache-Control': 'private, max-age=30' },
          },
        ),
      );
    }
    return withSecurityHeaders(
      request,
      new Response('Not Found', { status: 404 }),
    );
  },
};

export default fixtureWorker;
