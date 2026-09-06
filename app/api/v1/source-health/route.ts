import { getD1 } from '@/db';
import { SourceHealthResponseSchema } from '@/shared/schemas';
import { getSourceHealth } from '@/worker/catalog';

export async function GET() {
  try {
    const response = SourceHealthResponseSchema.parse(
      await getSourceHealth(getD1()),
    );
    return Response.json(response, {
      headers: { 'Cache-Control': 'public, max-age=15' },
    });
  } catch (error) {
    console.error('Source health query failed', error);
    return Response.json(
      {
        error: {
          code: 'SOURCE_HEALTH_UNAVAILABLE',
          message: 'Source health is temporarily unavailable.',
        },
      },
      { status: 503 },
    );
  }
}
