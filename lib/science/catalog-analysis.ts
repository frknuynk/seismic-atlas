import type { CatalogEvent } from '@/shared/schemas';

export const CATALOG_ANALYSIS_VERSION = 'catalog-analysis-v1';

export function catalogAnalysisKey(events: CatalogEvent[]) {
  return events
    .map((event) =>
      [
        event.id,
        event.originTime,
        event.magnitude ?? '',
        event.magnitudeType ?? '',
        event.depthKm ?? '',
      ].join('\u001f'),
    )
    .join('\u001e');
}

export type HistogramBin = {
  start: number;
  end: number | null;
  label: string;
  count: number;
};

export type TimeHistogramBin = {
  startMs: number;
  endMs: number;
  count: number;
};

export type FrequencyMagnitudePoint = {
  magnitude: number;
  count: number;
};

export type CatalogAnalysis = {
  version: typeof CATALOG_ANALYSIS_VERSION;
  eventCount: number;
  firstEventTime: string | null;
  lastEventTime: string | null;
  maximumMagnitude: number | null;
  magnitudeCoveragePercent: number;
  depthCoveragePercent: number;
  magnitudeTypes: Array<{ type: string; count: number }>;
  timeHistogram: TimeHistogramBin[];
  magnitudeHistogram: HistogramBin[];
  depthHistogram: HistogramBin[];
  frequencyMagnitude: FrequencyMagnitudePoint[];
  quality: {
    status: 'empty' | 'limited' | 'descriptive';
    messages: string[];
  };
};

const DEPTH_BINS = [0, 5, 10, 20, 40, 70] as const;

function round(value: number, precision = 6) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function numericHistogram(values: number[], binWidth: number) {
  if (values.length === 0) return [];
  const minimum = Math.floor(Math.min(...values) / binWidth) * binWidth;
  const maximum = Math.max(...values);
  const binCount = Math.max(1, Math.floor((maximum - minimum) / binWidth) + 1);
  const bins = Array.from({ length: binCount }, (_, index) => {
    const start = round(minimum + index * binWidth);
    const end = round(start + binWidth);
    return {
      start,
      end,
      label: `${start.toFixed(1)}–${end.toFixed(1)}`,
      count: 0,
    };
  });

  for (const value of values) {
    const index = Math.min(
      bins.length - 1,
      Math.max(0, Math.floor((value - minimum) / binWidth)),
    );
    bins[index]!.count += 1;
  }
  return bins;
}

function depthHistogram(values: number[]): HistogramBin[] {
  const bins: HistogramBin[] = DEPTH_BINS.map((start, index) => {
    const end = DEPTH_BINS[index + 1] ?? null;
    return {
      start,
      end,
      label: end === null ? `${start}+` : `${start}–${end}`,
      count: 0,
    };
  });

  for (const value of values) {
    const index = DEPTH_BINS.findIndex((start, candidate) => {
      const end = DEPTH_BINS[candidate + 1];
      return value >= start && (end === undefined || value < end);
    });
    if (index >= 0) bins[index]!.count += 1;
  }
  return bins;
}

function timeHistogram(
  times: number[],
  requestedBins = 18,
): TimeHistogramBin[] {
  if (times.length === 0) return [];
  const minimum = Math.min(...times);
  const maximum = Math.max(...times);
  const span = Math.max(1, maximum - minimum);
  const binCount = Math.min(requestedBins, Math.max(1, times.length));
  const binWidth = Math.max(1, Math.ceil(span / binCount));
  const bins = Array.from({ length: binCount }, (_, index) => ({
    startMs: minimum + index * binWidth,
    endMs:
      index === binCount - 1 ? maximum + 1 : minimum + (index + 1) * binWidth,
    count: 0,
  }));

  for (const time of times) {
    const index = Math.min(
      bins.length - 1,
      Math.max(0, Math.floor((time - minimum) / binWidth)),
    );
    bins[index]!.count += 1;
  }
  return bins;
}

function frequencyMagnitude(values: number[]): FrequencyMagnitudePoint[] {
  if (values.length === 0) return [];
  const minimum = Math.floor(Math.min(...values) * 10) / 10;
  const maximum = Math.ceil(Math.max(...values) * 10) / 10;
  const points: FrequencyMagnitudePoint[] = [];

  for (
    let magnitude = minimum;
    magnitude <= maximum + 0.001;
    magnitude += 0.1
  ) {
    const threshold = round(magnitude, 1);
    points.push({
      magnitude: threshold,
      count: values.filter((value) => value + 0.0001 >= threshold).length,
    });
  }
  return points;
}

export function analyzeCatalog(events: CatalogEvent[]): CatalogAnalysis {
  const times = events
    .map((event) => Date.parse(event.originTime))
    .filter(Number.isFinite);
  const magnitudes = events.flatMap((event) =>
    event.magnitude === null ? [] : [event.magnitude],
  );
  const depths = events.flatMap((event) =>
    event.depthKm === null ? [] : [event.depthKm],
  );
  const magnitudeTypeCounts = new Map<string, number>();
  for (const event of events) {
    const type = event.magnitudeType ?? 'Unspecified';
    magnitudeTypeCounts.set(type, (magnitudeTypeCounts.get(type) ?? 0) + 1);
  }
  const magnitudeTypes = [...magnitudeTypeCounts]
    .map(([type, count]) => ({ type, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.type.localeCompare(right.type),
    );

  const messages: string[] = [];
  if (events.length === 0) {
    messages.push('No events are available in the current catalog subset.');
  } else {
    if (events.length < 50) {
      messages.push(
        'This subset is small; the distributions are descriptive only.',
      );
    }
    if (magnitudeTypes.length > 1) {
      messages.push(
        'Multiple magnitude types are present and have not been homogenized.',
      );
    }
    messages.push(
      'Catalog completeness has not been estimated, so no b-value is reported.',
    );
  }

  return {
    version: CATALOG_ANALYSIS_VERSION,
    eventCount: events.length,
    firstEventTime:
      times.length > 0 ? new Date(Math.min(...times)).toISOString() : null,
    lastEventTime:
      times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
    maximumMagnitude: magnitudes.length > 0 ? Math.max(...magnitudes) : null,
    magnitudeCoveragePercent:
      events.length === 0
        ? 0
        : Math.round((magnitudes.length / events.length) * 100),
    depthCoveragePercent:
      events.length === 0
        ? 0
        : Math.round((depths.length / events.length) * 100),
    magnitudeTypes,
    timeHistogram: timeHistogram(times),
    magnitudeHistogram: numericHistogram(magnitudes, 0.5),
    depthHistogram: depthHistogram(depths),
    frequencyMagnitude: frequencyMagnitude(magnitudes),
    quality: {
      status:
        events.length === 0
          ? 'empty'
          : events.length < 50
            ? 'limited'
            : 'descriptive',
      messages,
    },
  };
}
