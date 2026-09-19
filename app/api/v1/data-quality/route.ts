import { getD1 } from '@/db';
import { CatalogQualityResponseSchema } from '@/shared/schemas';
import { getCatalogQuality } from '@/worker/catalog-quality';

export async function GET() {
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
    console.error('Catalog quality audit failed', error);
    return Response.json(
      {
        error: {
          code: 'CATALOG_QUALITY_UNAVAILABLE',
          message: 'Catalog quality metrics are temporarily unavailable.',
        },
      },
      { status: 503 },
    );
  }
}
