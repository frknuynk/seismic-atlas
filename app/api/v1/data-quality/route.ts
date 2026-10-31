import { getD1 } from '@/db';
import { CatalogQualityResponseSchema } from '@/shared/schemas';
import { getCachedCatalogQuality } from '@/worker/catalog-quality-cache';
import { apiErrorResponse, logApiError } from '@/worker/observability';

export async function GET(request: Request) {
  try {
    const quality = CatalogQualityResponseSchema.parse(
      await getCachedCatalogQuality(getD1()),
    );
    return Response.json(quality, {
      headers: {
        'Cache-Control':
          'public, max-age=60, s-maxage=900, stale-while-revalidate=3600',
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
