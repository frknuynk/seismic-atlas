import { getD1 } from '@/db';
import { EventDetailSchema } from '@/shared/schemas';
import { getEventDetail } from '@/worker/catalog';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const event = await getEventDetail(getD1(), decodeURIComponent(id));

    if (!event) {
      return Response.json(
        { error: { code: 'EVENT_NOT_FOUND', message: 'Event not found.' } },
        { status: 404 },
      );
    }

    return Response.json(EventDetailSchema.parse(event), {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('Event detail query failed', error);
    return Response.json(
      {
        error: {
          code: 'EVENT_DETAIL_UNAVAILABLE',
          message: 'Event detail is temporarily unavailable.',
        },
      },
      { status: 503 },
    );
  }
}
