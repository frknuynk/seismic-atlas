import vinextHandler from 'vinext/server/fetch-handler';
import {
  apiErrorResponse,
  logEvent,
  logHttpResponse,
  observeRequest,
  serializeError,
  withRequestId,
} from '@/worker/observability';
import { runObservedScheduledAfadSync } from '@/worker/scheduled';
import { withSecurityHeaders } from '@/worker/security';

const worker = {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    context: ExecutionContext,
  ) {
    const observation = observeRequest(request);

    try {
      const response = await vinextHandler.fetch(
        observation.request,
        env,
        context,
      );
      logHttpResponse(observation, response);
      return withSecurityHeaders(
        request,
        withRequestId(response, observation.requestId),
      );
    } catch (error) {
      logEvent('error', 'http.request.unhandled_error', {
        requestId: observation.requestId,
        edgeRayId: observation.edgeRayId,
        method: request.method,
        path: new URL(request.url).pathname,
        durationMs: Math.max(0, Date.now() - observation.startedAt),
        error: serializeError(error),
      });

      if (new URL(request.url).pathname.startsWith('/api/')) {
        const response = apiErrorResponse(observation.request, {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'The API request could not be completed.',
          status: 500,
          headers: { 'Cache-Control': 'no-store' },
        });
        return withSecurityHeaders(request, response);
      }

      throw error;
    }
  },

  scheduled(
    controller: ScheduledController,
    env: Cloudflare.Env,
    context: ExecutionContext,
  ) {
    context.waitUntil(
      runObservedScheduledAfadSync(env.DB, {
        scheduledTime: controller.scheduledTime,
      }),
    );
  },
};

export default worker;
