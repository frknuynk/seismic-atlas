'use client';

import { ExternalLink, History, MapPin, Waves } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import type { NearbyFault } from '@/lib/geo/nearest-fault';
import type { CatalogEvent, EventDetail } from '@/shared/schemas';

function dateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function valueOrDash(value: number | null, suffix = '') {
  return value === null ? 'Not reported' : `${value.toFixed(2)}${suffix}`;
}

type EventDetailSheetProps = {
  eventId: string | null;
  summary: CatalogEvent | null;
  detail: EventDetail | null;
  loading: boolean;
  nearbyFault: NearbyFault | null;
  nearbyFaultLoading: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EventDetailSheet({
  eventId,
  summary,
  detail,
  loading,
  nearbyFault,
  nearbyFaultLoading,
  onOpenChange,
}: EventDetailSheetProps) {
  const event = detail ?? summary;

  return (
    <Sheet open={eventId !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[92vw] overflow-y-auto sm:max-w-md"
      >
        <SheetHeader className="border-b pr-12">
          <div className="mb-2 flex items-center gap-2">
            <Badge className="border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
              Official Türkiye · AFAD
            </Badge>
            {detail?.sourceStatus && (
              <Badge variant="outline">{detail.sourceStatus}</Badge>
            )}
          </div>
          <SheetTitle className="text-xl">
            {event?.place ?? 'Loading earthquake…'}
          </SheetTitle>
          <SheetDescription>
            {event
              ? dateTime(event.originTime)
              : 'Loading current source solution'}{' '}
            UTC
          </SheetDescription>
        </SheetHeader>

        {loading && !event ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : event ? (
          <div className="space-y-6 p-4">
            <section aria-labelledby="solution-title">
              <h3
                id="solution-title"
                className="mb-3 flex items-center gap-2 font-medium"
              >
                <Waves className="size-4 text-primary" aria-hidden="true" />
                Current solution
              </h3>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
                <div className="bg-card p-3">
                  <dt className="text-xs text-muted-foreground">Magnitude</dt>
                  <dd className="mt-1 font-mono text-lg font-semibold">
                    {event.magnitudeType ?? 'M'} {valueOrDash(event.magnitude)}
                  </dd>
                </div>
                <div className="bg-card p-3">
                  <dt className="text-xs text-muted-foreground">Depth</dt>
                  <dd className="mt-1 font-mono text-lg font-semibold">
                    {valueOrDash(event.depthKm, ' km')}
                  </dd>
                </div>
                <div className="bg-card p-3">
                  <dt className="text-xs text-muted-foreground">Latitude</dt>
                  <dd className="mt-1 font-mono">
                    {event.latitude.toFixed(5)}°
                  </dd>
                </div>
                <div className="bg-card p-3">
                  <dt className="text-xs text-muted-foreground">Longitude</dt>
                  <dd className="mt-1 font-mono">
                    {event.longitude.toFixed(5)}°
                  </dd>
                </div>
              </dl>
            </section>

            <section aria-labelledby="fault-context-title">
              <h3
                id="fault-context-title"
                className="mb-3 flex items-center gap-2 font-medium"
              >
                <MapPin className="size-4 text-pink-300" aria-hidden="true" />
                Nearest mapped fault
                <Badge variant="secondary" className="ml-auto">
                  GEM
                </Badge>
              </h3>
              {nearbyFaultLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : nearbyFault ? (
                <div className="rounded-lg border border-pink-300/20 bg-pink-300/5 p-3 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <span className="font-medium">{nearbyFault.label}</span>
                    <span className="shrink-0 font-mono text-pink-200">
                      {nearbyFault.distanceKm < 10
                        ? nearbyFault.distanceKm.toFixed(1)
                        : Math.round(nearbyFault.distanceKm)}{' '}
                      km
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Catalog ID</dt>
                      <dd className="mt-0.5 font-mono">
                        {nearbyFault.catalog_id ?? nearbyFault.id}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Source catalog</dt>
                      <dd className="mt-0.5">
                        {nearbyFault.catalog_name ?? 'GEM global database'}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Straight-line distance to the nearest GEM-mapped segment.
                    Proximity does not establish which fault caused this event.
                  </p>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  Fault context is unavailable for this event.
                </p>
              )}
            </section>

            <section aria-labelledby="provenance-title">
              <h3
                id="provenance-title"
                className="mb-3 flex items-center gap-2 font-medium"
              >
                <MapPin className="size-4 text-primary" aria-hidden="true" />
                Provenance
              </h3>
              <div className="rounded-lg border bg-card/55 p-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Source event</span>
                  <a
                    href={`https://deprem.afad.gov.tr/event-detail/${event.sourceEventId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                  >
                    {event.sourceEventId}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </div>
                {detail && (
                  <>
                    <div className="mt-2 flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">
                        First observed
                      </span>
                      <span>{dateTime(detail.firstSeenAt)} UTC</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">
                        Last observed
                      </span>
                      <span>{dateTime(detail.lastSeenAt)} UTC</span>
                    </div>
                  </>
                )}
              </div>
            </section>

            <section aria-labelledby="revision-title">
              <h3
                id="revision-title"
                className="mb-3 flex items-center gap-2 font-medium"
              >
                <History className="size-4 text-primary" aria-hidden="true" />
                Source history
                <Badge variant="secondary" className="ml-auto">
                  {detail?.revisionCount ?? event.revisionCount} revision
                  {(detail?.revisionCount ?? event.revisionCount) === 1
                    ? ''
                    : 's'}
                </Badge>
              </h3>
              <div className="space-y-2">
                {detail?.revisions.map((revision) => (
                  <div
                    key={revision.revisionNo}
                    className="rounded-lg border bg-card/55 p-3"
                  >
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span>Revision {revision.revisionNo}</span>
                      <span className="text-xs text-muted-foreground">
                        {dateTime(revision.observedAt)} UTC
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {revision.magnitudeType ?? 'M'}{' '}
                      {valueOrDash(revision.magnitude)} ·{' '}
                      {valueOrDash(revision.depthKm, ' km deep')}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
              Earthquake parameters are estimates and may be revised by the
              source. Terrain relief is geographic context, not a hazard score.
            </p>
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            This event is no longer available in the stored catalog.
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
