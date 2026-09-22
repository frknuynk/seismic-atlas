import { getD1 } from '@/db';
import { SourceHealthResponseSchema } from '@/shared/schemas';
import { getSourceHealth } from '@/worker/catalog';
import { apiErrorResponse, logApiError } from '@/worker/observability';

export async function GET(request: Request) {
  try {
    const response = SourceHealthResponseSchema.parse(
      await getSourceHealth(getD1()),
    );
    return Response.json(response, {
      headers: { 'Cache-Control': 'public, max-age=15' },
    });
  } catch (error) {
    logApiError(request, 'api.source_health.query_failed', error);
    return apiErrorResponse(request, {
      code: 'SOURCE_HEALTH_UNAVAILABLE',
      message: 'Source health is temporarily unavailable.',
      status: 503,
    });
  }
}
