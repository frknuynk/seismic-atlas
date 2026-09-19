import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { CatalogQualityResponse } from '@/shared/schemas';

type CatalogIntegrityProps = {
  quality: CatalogQualityResponse | null;
  state: 'loading' | 'ready' | 'error';
  onRefresh: () => void;
  titleId?: string;
};

const coverageFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Istanbul',
});

function coverageLabel(quality: CatalogQualityResponse) {
  const { firstEventTime, lastEventTime } = quality.coverage;
  if (!firstEventTime || !lastEventTime) return 'No stored coverage';
  return `${coverageFormat.format(new Date(firstEventTime))} – ${coverageFormat.format(new Date(lastEventTime))}`;
}

export function CatalogIntegrity({
  quality,
  state,
  onRefresh,
  titleId = 'integrity-title',
}: CatalogIntegrityProps) {
  const ingestionLast7Days = quality?.ingestionLast7Days ?? {
    runs: 0,
    fetched: 0,
    accepted: 0,
    rejected: 0,
    duplicatesDropped: 0,
  };

  return (
    <section aria-labelledby={titleId}>
      <div className="mb-2 flex items-center justify-between">
        <h2
          id={titleId}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
        >
          <DatabaseZap className="size-4" aria-hidden="true" />
          Catalog integrity
        </h2>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onRefresh}
          aria-label="Refresh catalog quality audit"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {state === 'loading' && !quality ? (
        <Skeleton className="h-28 w-full" />
      ) : quality ? (
        <div className="rounded-md border bg-card/55 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              {quality.status === 'healthy' ? (
                <CheckCircle2
                  className="size-4 text-emerald-300"
                  aria-hidden="true"
                />
              ) : (
                <AlertTriangle
                  className={
                    quality.status === 'critical'
                      ? 'size-4 text-rose-300'
                      : 'size-4 text-amber-300'
                  }
                  aria-hidden="true"
                />
              )}
              {quality.counts.total.toLocaleString()} stored events
            </span>
            <Badge
              variant="outline"
              className={
                quality.status === 'healthy'
                  ? 'border-emerald-300/25 text-emerald-200'
                  : quality.status === 'critical'
                    ? 'border-rose-300/25 text-rose-200'
                    : 'border-amber-300/25 text-amber-200'
              }
            >
              {quality.status}
            </Badge>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {coverageLabel(quality)}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border bg-background/35 p-2">
              <dt className="text-muted-foreground">Magnitude coverage</dt>
              <dd className="mt-0.5 font-mono font-medium">
                {quality.coveragePercent.magnitude.toFixed(1)}%
              </dd>
            </div>
            <div className="rounded border bg-background/35 p-2">
              <dt className="text-muted-foreground">Depth coverage</dt>
              <dd className="mt-0.5 font-mono font-medium">
                {quality.coveragePercent.depth.toFixed(1)}%
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {quality.counts.revisedEvents.toLocaleString()} revised events ·{' '}
            {quality.checks.filter((check) => check.status !== 'pass').length}{' '}
            checks need attention
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            Last 7 days: {ingestionLast7Days.rejected.toLocaleString()} rejected
            · {ingestionLast7Days.duplicatesDropped.toLocaleString()} duplicates
            dropped
          </p>
        </div>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-xs leading-5 text-muted-foreground">
          Catalog quality metrics are temporarily unavailable.
        </p>
      )}
    </section>
  );
}
