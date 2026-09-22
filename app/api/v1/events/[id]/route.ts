import { getD1 } from '@/db';
import { EventDetailSchema } from '@/shared/schemas';
import { getEventDetail } from '@/worker/catalog';
import { apiErrorResponse, logApiError } from '@/worker/observability';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const event = await getEventDetail(getD1(), decodeURIComponent(id));

    if (!event) {
      return apiErrorResponse(request, {
        code: 'EVENT_NOT_FOUND',
        message: 'Event not found.',
        status: 404,
      });
    }

    return Response.json(EventDetailSchema.parse(event), {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    logApiError(request, 'api.event_detail.query_failed', error);
    return apiErrorResponse(request, {
      code: 'EVENT_DETAIL_UNAVAILABLE',
      message: 'Event detail is temporarily unavailable.',
      status: 503,
    });
  }
}
