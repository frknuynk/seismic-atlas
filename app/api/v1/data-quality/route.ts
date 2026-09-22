import { getD1 } from '@/db';
import { CatalogQualityResponseSchema } from '@/shared/schemas';
import { getCatalogQuality } from '@/worker/catalog-quality';
import { apiErrorResponse, logApiError } from '@/worker/observability';

export async function GET(request: Request) {
  try {
    const quality = CatalogQualityResponseSchema.parse(
      await getCatalogQuality(getD1()),
    );
    return Response.json(quality, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logApiError(request, 'api.catalog_quality.query_failed', error);
    return apiErrorResponse(request, {
      code: 'CATALOG_QUALITY_UNAVAILABLE',
      message: 'Catalog quality metrics are temporarily unavailable.',
      status: 503,
    });
  }
}
