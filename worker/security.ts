import {
  apiErrorResponse,
  logEvent,
  serializeError,
} from '@/worker/observability';

const MANUAL_SYNC_RETRY_AFTER_SECONDS = 60;

const BASE_SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' https:",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: https:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join('; '),
  'Permissions-Policy': [
    'camera=()',
    'geolocation=()',
    'microphone=()',
    'payment=()',
    'usb=()',
    'clipboard-write=(self)',
  ].join(', '),
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const;

export function withSecurityHeaders(request: Request, response: Response) {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  if (new URL(request.url).protocol === 'https:') {
    headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function isManualSyncRateLimited(
  rateLimiter: RateLimit | undefined,
  requestId?: string,
) {
  if (!rateLimiter) return false;

  try {
    const outcome = await rateLimiter.limit({ key: 'afad-manual-sync' });
    return !outcome.success;
  } catch (error) {
    // The D1 lease and bearer token still protect the operation. A temporary
    // limiter outage must not disable an authorized recovery sync.
    logEvent('error', 'rate_limit.binding_failed', {
      requestId,
      error: serializeError(error),
    });
    return false;
  }
}

export function manualSyncRateLimitedResponse(request: Request) {
  return apiErrorResponse(request, {
    code: 'RATE_LIMITED',
    message: 'Too many manual synchronization requests. Try again shortly.',
    status: 429,
    headers: {
      'Cache-Control': 'no-store',
      'Retry-After': String(MANUAL_SYNC_RETRY_AFTER_SECONDS),
    },
  });
}
