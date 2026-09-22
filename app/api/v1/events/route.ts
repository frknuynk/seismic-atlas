import { getD1 } from '@/db';
import { EventQuerySchema, EventsResponseSchema } from '@/shared/schemas';
import { InvalidCatalogCursorError, queryEvents } from '@/worker/catalog';
import { apiErrorResponse, logApiError } from '@/worker/observability';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = EventQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );

  if (!parsed.success) {
    return apiErrorResponse(request, {
      code: 'INVALID_EVENT_QUERY',
      message: 'Use a valid bounded time range and numeric map filters.',
      status: 400,
      details: { issues: parsed.error.issues },
    });
  }

  try {
    const response = EventsResponseSchema.parse(
      await queryEvents(getD1(), parsed.data),
    );
    return Response.json(response, {
      headers: {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    if (error instanceof InvalidCatalogCursorError) {
      return apiErrorResponse(request, {
        code: 'INVALID_EVENT_CURSOR',
        message: 'Restart the catalog query without the supplied cursor.',
        status: 400,
      });
    }
    logApiError(request, 'api.events.query_failed', error);
    return apiErrorResponse(request, {
      code: 'CATALOG_UNAVAILABLE',
      message: 'The stored earthquake catalog is temporarily unavailable.',
      status: 503,
    });
  }
}
