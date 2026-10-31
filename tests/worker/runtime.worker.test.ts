import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import fixtureWorker from '@/tests/worker/fixture-worker';
import { pruneRecentAfadCatalog } from '@/worker/catalog-retention';
import {
  isSameOriginAppDataRequest,
  withSecurityHeaders,
} from '@/worker/security';

const DAY_MS = 24 * 60 * 60_000;

async function insertEvent(id: string, source: string, originTime: number) {
  await env.DB.prepare(
    `INSERT INTO source_events (
      id, source, source_event_id, origin_time, latitude, longitude,
      first_seen_at, last_seen_at, payload_hash
    ) VALUES (?, ?, ?, ?, 39, 35, ?, ?, ?)`,
  )
    .bind(id, source, id, originTime, originTime, originTime, `hash-${id}`)
    .run();
}

describe('workerd runtime and isolated D1', () => {
  it('applies real migrations and retains only the recent AFAD window', async () => {
    const now = Date.UTC(2026, 9, 31, 12);
    await insertEvent('AFAD:recent', 'AFAD', now - DAY_MS);
    await insertEvent('AFAD:old', 'AFAD', now - 8 * DAY_MS);
    await insertEvent('USGS:recent', 'USGS', now - DAY_MS);

    const result = await pruneRecentAfadCatalog(env.DB, now);
    const rows = await env.DB.prepare(
      'SELECT id, source FROM source_events ORDER BY id',
    ).all<{ id: string; source: string }>();

    expect(result.eventsDeleted).toBe(2);
    expect(rows.results).toEqual([{ id: 'AFAD:recent', source: 'AFAD' }]);
  });

  it('enforces fetch metadata and Worker security headers', () => {
    const request = new Request('https://atlas.example/api/v1/events', {
      headers: {
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
      },
    });
    expect(isSameOriginAppDataRequest(request)).toBe(true);

    const response = withSecurityHeaders(request, new Response('ok'));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "worker-src 'self'",
    );
    expect(response.headers.get('Content-Security-Policy')).not.toContain(
      "worker-src 'self' blob:",
    );
    expect(response.headers.get('Content-Security-Policy')).not.toContain(
      "'unsafe-eval'",
    );
    expect(response.headers.get('Strict-Transport-Security')).toContain(
      'max-age=31536000',
    );
  });

  it('permits React development eval only on loopback hosts', () => {
    const response = withSecurityHeaders(
      new Request('http://127.0.0.1:5173/'),
      new Response('ok'),
    );
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
  });

  it('executes Worker fetch against the real D1 binding with private cache and no CORS', async () => {
    await insertEvent('AFAD:fetch', 'AFAD', Date.now());
    const response = await fixtureWorker.fetch(
      new Request('https://atlas.example/test/event-count'),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 1 });
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=30');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
