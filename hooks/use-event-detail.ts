'use client';

import { useEffect, useState } from 'react';
import type { EventDetail } from '@/shared/schemas';

export function useEventDetail(eventId: string | null) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!eventId) {
      setDetail(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setDetail(null);
    setLoading(true);

    void fetch(`/api/v1/events/${encodeURIComponent(eventId)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Event detail unavailable.');
        return response.json() as Promise<EventDetail>;
      })
      .then((payload) => setDetail(payload))
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') setDetail(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [eventId]);

  return { detail, loading };
}
