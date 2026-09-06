import { getD1 } from '@/db';
import { EventQuerySchema, EventsResponseSchema } from '@/shared/schemas';
import { queryEvents } from '@/worker/catalog';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = EventQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );

  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'INVALID_EVENT_QUERY',
          message: 'Use a valid bounded time range and numeric map filters.',
          issues: parsed.error.issues,
        },
      },
      { status: 400 },
    );
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
    console.error('Event query failed', error);
    return Response.json(
      {
        error: {
          code: 'CATALOG_UNAVAILABLE',
          message: 'The stored earthquake catalog is temporarily unavailable.',
        },
      },
      { status: 503 },
    );
  }
}
