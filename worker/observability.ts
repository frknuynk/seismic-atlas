const INTERNAL_REQUEST_ID_HEADER = 'X-Seismic-Request-ID';
export const REQUEST_ID_HEADER = 'X-Request-ID';

type LogLevel = 'info' | 'warn' | 'error';
type LogValue = string | number | boolean | null | undefined;
type LogFields = Record<string, LogValue | Record<string, LogValue>>;

export type RequestObservation = {
  request: Request;
  requestId: string;
  startedAt: number;
  edgeRayId: string | null;
};

export function observeRequest(
  request: Request,
  options: { requestId?: string; now?: number } = {},
): RequestObservation {
  const requestId = options.requestId ?? crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set(INTERNAL_REQUEST_ID_HEADER, requestId);

  return {
    request: new Request(request, { headers }),
    requestId,
    startedAt: options.now ?? Date.now(),
    edgeRayId: request.headers.get('cf-ray')?.slice(0, 128) ?? null,
  };
}

export function requestIdFrom(request: Request) {
  return request.headers.get(INTERNAL_REQUEST_ID_HEADER) ?? crypto.randomUUID();
}

export function withRequestId(response: Response, requestId: string) {
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    const code =
      'code' in error && typeof error.code === 'string' ? error.code : null;
    return {
      name: error.name.slice(0, 128),
      message: error.message.slice(0, 500),
      code,
    };
  }

  return {
    name: 'UnknownError',
    message: 'An unknown error occurred.',
    code: null,
  };
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
) {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'seismic-atlas',
    event,
    ...fields,
  });

  console[level](record);
}

export function logApiError(
  request: Request,
  event: string,
  error: unknown,
  fields: LogFields = {},
) {
  logEvent('error', event, {
    requestId: requestIdFrom(request),
    ...fields,
    error: serializeError(error),
  });
}

export function logHttpResponse(
  observation: RequestObservation,
  response: Response,
  completedAt = Date.now(),
) {
  if (response.status < 400) return;

  const event =
    response.status === 401
      ? 'http.request.unauthorized'
      : response.status === 429
        ? 'http.request.rate_limited'
        : response.status >= 500
          ? 'http.request.failed'
          : 'http.request.rejected';
  const level: LogLevel = response.status >= 500 ? 'error' : 'warn';

  logEvent(level, event, {
    requestId: observation.requestId,
    edgeRayId: observation.edgeRayId,
    method: observation.request.method,
    path: new URL(observation.request.url).pathname,
    status: response.status,
    durationMs: Math.max(0, completedAt - observation.startedAt),
  });
}

export function apiErrorResponse(
  request: Request,
  error: {
    code: string;
    message: string;
    status: number;
    details?: Record<string, unknown>;
    headers?: HeadersInit;
  },
) {
  const requestId = requestIdFrom(request);
  const headers = new Headers(error.headers);
  headers.set(REQUEST_ID_HEADER, requestId);

  return Response.json(
    {
      error: {
        ...error.details,
        code: error.code,
        message: error.message,
        requestId,
      },
    },
    { status: error.status, headers },
  );
}
