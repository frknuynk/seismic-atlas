import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiErrorResponse,
  logEvent,
  logHttpResponse,
  observeRequest,
  requestIdFrom,
  serializeError,
  withRequestId,
} from '@/worker/observability';

describe('worker observability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a trusted request ID and preserves the incoming request', async () => {
    const incoming = new Request(
      'https://atlas.example.com/api/v1/events?q=secret',
      {
        method: 'POST',
        headers: {
          'X-Request-ID': 'untrusted-client-id',
          'CF-Ray': 'edge-ray',
        },
        body: 'payload',
      },
    );
    const observation = observeRequest(incoming, {
      requestId: 'trusted-request-id',
      now: 100,
    });

    expect(observation.requestId).toBe('trusted-request-id');
    expect(observation.startedAt).toBe(100);
    expect(observation.edgeRayId).toBe('edge-ray');
    expect(observation.request.method).toBe('POST');
    await expect(observation.request.text()).resolves.toBe('payload');
    expect(requestIdFrom(observation.request)).toBe('trusted-request-id');
  });

  it('adds a response request ID without replacing cache metadata', async () => {
    const response = withRequestId(
      new Response('ok', {
        status: 202,
        headers: { 'Cache-Control': 'public, max-age=30' },
      }),
      'request-id',
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('X-Request-ID')).toBe('request-id');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=30');
    await expect(response.text()).resolves.toBe('ok');
  });

  it('returns correlation IDs in stable API error envelopes', async () => {
    const request = observeRequest(
      new Request('https://atlas.example.com/api'),
      {
        requestId: 'request-id',
      },
    ).request;
    const response = apiErrorResponse(request, {
      code: 'TEST_ERROR',
      message: 'Test failure.',
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
      details: { retryable: true },
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('X-Request-ID')).toBe('request-id');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'TEST_ERROR',
        message: 'Test failure.',
        requestId: 'request-id',
        retryable: true,
      },
    });
  });

  it('writes structured JSON logs without error stacks', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const error = Object.assign(new Error('upstream failed'), {
      code: 'UPSTREAM_ERROR',
    });

    logEvent('error', 'test.failed', {
      requestId: 'request-id',
      error: serializeError(error),
    });

    expect(consoleError).toHaveBeenCalledOnce();
    const record = JSON.parse(String(consoleError.mock.calls[0]?.[0]));
    expect(record).toMatchObject({
      level: 'error',
      service: 'seismic-atlas',
      event: 'test.failed',
      requestId: 'request-id',
      error: {
        name: 'Error',
        message: 'upstream failed',
        code: 'UPSTREAM_ERROR',
      },
    });
    expect(record.error).not.toHaveProperty('stack');
  });

  it.each([
    [401, 'http.request.unauthorized', 'warn'],
    [429, 'http.request.rate_limited', 'warn'],
    [503, 'http.request.failed', 'error'],
  ] as const)('classifies HTTP %i logs', (status, event, level) => {
    const logger = vi.spyOn(console, level).mockImplementation(() => {});
    const observation = observeRequest(
      new Request('https://atlas.example.com/api/v1/events?token=hidden'),
      { requestId: 'request-id', now: 100 },
    );

    logHttpResponse(observation, new Response(null, { status }), 145);

    const record = JSON.parse(String(logger.mock.calls[0]?.[0]));
    expect(record).toMatchObject({
      event,
      requestId: 'request-id',
      method: 'GET',
      path: '/api/v1/events',
      status,
      durationMs: 45,
    });
    expect(JSON.stringify(record)).not.toContain('token=hidden');
  });

  it('does not emit custom logs for successful HTTP responses', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const observation = observeRequest(
      new Request('https://atlas.example.com/api/v1/health'),
      { requestId: 'request-id' },
    );

    logHttpResponse(observation, new Response(null, { status: 200 }));

    expect(consoleInfo).not.toHaveBeenCalled();
  });
});
