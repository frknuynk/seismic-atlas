import vinextHandler from 'vinext/server/fetch-handler';
import { runAfadSync } from '@/worker/ingestion/afad';

const worker = {
  fetch(request: Request, env: Cloudflare.Env, context: ExecutionContext) {
    return vinextHandler.fetch(request, env, context);
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
