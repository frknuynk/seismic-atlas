import { getD1 } from '@/db';
import { EventDetailSchema } from '@/shared/schemas';
import { getEventDetail } from '@/worker/catalog';
import { apiErrorResponse, logApiError } from '@/worker/observability';
import {
  appDataRequestRejectedResponse,
  isSameOriginAppDataRequest,
} from '@/worker/security';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginAppDataRequest(request)) {
    return appDataRequestRejectedResponse(request);
  }

  try {
    const { id } = await context.params;
    const decodedId = decodeURIComponent(id);
    const event = decodedId.startsWith('AFAD:')
      ? await getEventDetail(getD1(), decodedId)
      : null;

    if (!event) {
      return apiErrorResponse(request, {
        code: 'EVENT_NOT_FOUND',
        message: 'Event not found.',
        status: 404,
      });
    }

    return Response.json(EventDetailSchema.parse(event), {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
        Vary: 'Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest',
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
