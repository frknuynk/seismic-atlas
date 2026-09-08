import { Hono } from 'hono';
import { ServiceHealthSchema } from '@/shared/schemas';

export type Bindings = {
  DB: D1Database;
};

export const api = new Hono<{ Bindings: Bindings }>();

api.get('/api/v1/health', (context) => {
  const payload = ServiceHealthSchema.parse({
    service: 'seismic-atlas-api',
    status: 'ok',
    phase: 1,
    version: '0.4.0-alpha.1',
    databaseBinding: 'DB',
    timestamp: new Date().toISOString(),
  });

  return context.json(payload, 200, {
    'Cache-Control': 'no-store',
  });
});

api.notFound((context) =>
  context.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested API route does not exist.',
      },
    },
    404,
  ),
);
