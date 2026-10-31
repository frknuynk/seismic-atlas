import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { GET as getEvents } from '@/app/api/v1/events/route';
import { GET as getEventDetail } from '@/app/api/v1/events/[id]/route';
import { GET as getHealth } from '@/app/api/v1/health/route';
import { GET as getQuality } from '@/app/api/v1/data-quality/route';
import { GET as getSourceHealth } from '@/app/api/v1/source-health/route';
import { POST as syncAfad } from '@/app/api/v1/internal/sync/afad/route';
import worker from '@/worker/index';

const headers = {
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
};

async function seedCatalog(now: number) {
  await env.DB.prepare(
    `INSERT INTO source_events (
      id, source, source_event_id, origin_time, latitude, longitude, depth_km,
      magnitude, magnitude_type, place_raw, source_status, source_updated_at,
      first_seen_at, last_seen_at, payload_hash
    ) VALUES ('AFAD:route', 'AFAD', 'route', ?, 39, 35, 8, 3.2, 'ML', NULL,
      'reviewed', ?, ?, ?, 'route-hash')`,
  )
    .bind(now, now, now, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO source_event_revisions (
      source_event_pk, revision_no, payload_hash, observed_at, source_updated_at,
      origin_time, latitude, longitude, depth_km, magnitude, magnitude_type, place_raw
    ) VALUES ('AFAD:route', 1, 'route-hash', ?, ?, ?, 39, 35, 8, 3.2, 'ML', NULL)`,
  )
    .bind(now, now, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO source_health (
      source, last_attempt_at, last_success_at, latest_event_time,
      consecutive_failures, status
    ) VALUES ('AFAD', ?, ?, ?, 0, 'ok')`,
  )
    .bind(now, now, now)
    .run();
}

describe('real Worker route modules', () => {
  it('serves bounded same-origin events and AFAD detail from D1', async () => {
    const now = Date.now();
    await seedCatalog(now);
    const start = new Date(now - 60 * 60_000).toISOString();
    const end = new Date(now + 60_000).toISOString();
    const response = await getEvents(
      new Request(
        `https://atlas.example/api/v1/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&source=AFAD`,
        { headers },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('private');
    expect((await response.json<{ events: unknown[] }>()).events).toHaveLength(
      1,
    );

    const detail = await getEventDetail(
      new Request('https://atlas.example/api/v1/events/AFAD%3Aroute', {
        headers,
      }),
      { params: Promise.resolve({ id: 'AFAD%3Aroute' }) },
    );
    expect(detail.status).toBe(200);
    expect((await detail.json<{ place: string | null }>()).place).toBeNull();
  });

  it('rejects cross-site, non-AFAD, and overlong catalog requests', async () => {
    const now = Date.now();
    const crossSite = await getEvents(
      new Request('https://atlas.example/api/v1/events'),
    );
    expect(crossSite.status).toBe(403);

    const start = new Date(now - 8 * 24 * 60 * 60_000).toISOString();
    const end = new Date(now).toISOString();
    for (const suffix of [
      `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&source=AFAD`,
      `start=${encodeURIComponent(end)}&end=${encodeURIComponent(end)}&source=USGS`,
    ]) {
      const response = await getEvents(
        new Request(`https://atlas.example/api/v1/events?${suffix}`, {
          headers,
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it('exposes service/source health and wraps the Worker fetch entry', async () => {
    const now = Date.now();
    await seedCatalog(now);
    expect(
      (await getHealth(new Request('https://atlas.example/api/v1/health')))
        .status,
    ).toBe(200);
    expect(
      (
        await getSourceHealth(
          new Request('https://atlas.example/api/v1/source-health'),
        )
      ).status,
    ).toBe(200);

    const response = await worker.fetch(
      new Request('https://atlas.example/'),
      env,
      {} as ExecutionContext,
    );
    expect(await response.text()).toBe('rendered');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "worker-src 'self'",
    );

    const apiFailure = await worker.fetch(
      new Request('https://atlas.example/api/throw'),
      env,
      {} as ExecutionContext,
    );
    expect(apiFailure.status).toBe(500);
    await expect(
      worker.fetch(
        new Request('https://atlas.example/throw'),
        env,
        {} as ExecutionContext,
      ),
    ).rejects.toThrow('render failure');

    const pending: Promise<unknown>[] = [];
    worker.scheduled({ scheduledTime: now } as ScheduledController, env, {
      waitUntil(promise) {
        pending.push(Promise.resolve(promise).catch(() => undefined));
      },
    } as ExecutionContext);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
  });

  it('serves quality and validates manual synchronization boundaries', async () => {
    const now = Date.now();
    await seedCatalog(now);
    const quality = await getQuality(
      new Request('https://atlas.example/api/v1/data-quality'),
    );
    expect(quality.status).toBe(200);
    expect(quality.headers.get('Cache-Control')).toContain('s-maxage=900');

    const unauthorized = await syncAfad(
      new Request('https://atlas.example/api/v1/internal/sync/afad', {
        method: 'POST',
      }),
    );
    expect(unauthorized.status).toBe(401);

    const invalidJson = await syncAfad(
      new Request('http://127.0.0.1/api/v1/internal/sync/afad', {
        method: 'POST',
        body: '{',
      }),
    );
    expect(invalidJson.status).toBe(400);

    const futureBackfill = await syncAfad(
      new Request('http://127.0.0.1/api/v1/internal/sync/afad', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'backfill',
          start: new Date(now + 60_000).toISOString(),
          end: new Date(now + 120_000).toISOString(),
        }),
      }),
    );
    expect(futureBackfill.status).toBe(400);
  });
});
