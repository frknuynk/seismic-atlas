import { describe, expect, it } from 'vitest';
import { api } from '@/worker/app';
import { ServiceHealthSchema } from '@/shared/schemas';

describe('GET /api/v1/health', () => {
  it('returns a valid uncached health response', async () => {
    const response = await api.request('http://localhost/api/v1/health');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(ServiceHealthSchema.parse(payload)).toMatchObject({
      service: 'seismic-atlas-api',
      status: 'ok',
      phase: 0,
      databaseBinding: 'DB',
    });
  });

  it('returns a stable error envelope for unknown API routes', async () => {
    const response = await api.request('http://localhost/api/v1/missing');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested API route does not exist.',
      },
    });
  });
});
