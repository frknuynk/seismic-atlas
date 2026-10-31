import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appDataRequestRejectedResponse,
  isManualSyncRateLimited,
  isSameOriginAppDataRequest,
  manualSyncRateLimitedResponse,
  withSecurityHeaders,
} from '@/worker/security';
import { observeRequest } from '@/worker/observability';

describe('security perimeter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds browser security headers without replacing response metadata', async () => {
    const request = new Request('https://atlas.example.com/');
    const response = withSecurityHeaders(
      request,
      new Response('atlas', {
        status: 202,
        headers: { 'Cache-Control': 'public, max-age=30' },
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe('atlas');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=30');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  it('does not advertise HSTS over local HTTP', () => {
    const response = withSecurityHeaders(
      new Request('http://localhost:3000/'),
      new Response(null),
    );

    expect(response.headers.has('Strict-Transport-Security')).toBe(false);
  });

  it('accepts only first-party browser data fetches', async () => {
    const firstParty = new Request('https://atlas.example.com/api/v1/events', {
      headers: {
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
      },
    });
    const crossSite = new Request('https://atlas.example.com/api/v1/events', {
      headers: {
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
      },
    });

    expect(isSameOriginAppDataRequest(firstParty)).toBe(true);
    expect(isSameOriginAppDataRequest(crossSite)).toBe(false);
    expect(isSameOriginAppDataRequest(new Request(firstParty.url))).toBe(false);
    expect(appDataRequestRejectedResponse(crossSite).status).toBe(403);
  });

  it('uses a route-level limiter key and reports a rejected request', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });

    await expect(
      isManualSyncRateLimited({ limit } satisfies RateLimit),
    ).resolves.toBe(true);
    expect(limit).toHaveBeenCalledWith({ key: 'afad-manual-sync' });
  });

  it('fails open when the optional limiter is unavailable', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const limit = vi.fn().mockRejectedValue(new Error('binding unavailable'));

    await expect(
      isManualSyncRateLimited({ limit } satisfies RateLimit),
    ).resolves.toBe(false);
    await expect(isManualSyncRateLimited(undefined)).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('returns a stable 429 envelope with retry guidance', async () => {
    const request = observeRequest(new Request('http://localhost/sync'), {
      requestId: 'test-request-id',
    }).request;
    const response = manualSyncRateLimitedResponse(request);

    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe('60');
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many manual synchronization requests. Try again shortly.',
        requestId: 'test-request-id',
      },
    });
  });
});
