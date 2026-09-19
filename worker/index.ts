import vinextHandler from 'vinext/server/fetch-handler';
import { runAfadSync } from '@/worker/ingestion/afad';
import { withSecurityHeaders } from '@/worker/security';

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, context: ExecutionContext) {
    const response = await vinextHandler.fetch(request, env, context);
    return withSecurityHeaders(request, response);
  },

  scheduled(
    _controller: ScheduledController,
    env: Cloudflare.Env,
    context: ExecutionContext,
  ) {
    context.waitUntil(runAfadSync(env.DB, { trigger: 'scheduled' }));
  },
};

export default worker;
