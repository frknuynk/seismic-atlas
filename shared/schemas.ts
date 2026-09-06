import { z } from 'zod';

export const SourceCodeSchema = z.enum(['AFAD', 'USGS', 'EMSC', 'ISC', 'GCMT']);

export const NormalizedSourceEventSchema = z.object({
  source: SourceCodeSchema,
  sourceEventId: z.string().min(1),
  originTime: z.iso.datetime({ offset: true }),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  depthKm: z.number().nonnegative().nullable(),
  magnitude: z.number().nullable(),
  magnitudeType: z.string().min(1).nullable(),
  placeRaw: z.string().nullable(),
  sourceStatus: z.string().nullable(),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const EventQuerySchema = z
  .object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    minLat: z.coerce.number().min(-90).max(90).optional(),
    maxLat: z.coerce.number().min(-90).max(90).optional(),
    minLon: z.coerce.number().min(-180).max(180).optional(),
    maxLon: z.coerce.number().min(-180).max(180).optional(),
    minMag: z.coerce.number().optional(),
    maxMag: z.coerce.number().optional(),
    minDepth: z.coerce.number().nonnegative().optional(),
    maxDepth: z.coerce.number().nonnegative().optional(),
    source: SourceCodeSchema.optional(),
    limit: z.coerce.number().int().positive().max(25_000).default(10_000),
  })
  .refine((value) => Date.parse(value.start) <= Date.parse(value.end), {
    message: 'start must be before or equal to end',
    path: ['start'],
  })
  .refine(
    (value) =>
      value.minLat === undefined ||
      value.maxLat === undefined ||
      value.minLat <= value.maxLat,
    { message: 'minLat must not exceed maxLat', path: ['minLat'] },
  )
  .refine(
    (value) =>
      value.minLon === undefined ||
      value.maxLon === undefined ||
      value.minLon <= value.maxLon,
    { message: 'minLon must not exceed maxLon', path: ['minLon'] },
  )
  .refine(
    (value) =>
      value.minMag === undefined ||
      value.maxMag === undefined ||
      value.minMag <= value.maxMag,
    { message: 'minMag must not exceed maxMag', path: ['minMag'] },
  )
  .refine(
    (value) =>
      value.minDepth === undefined ||
      value.maxDepth === undefined ||
      value.minDepth <= value.maxDepth,
    { message: 'minDepth must not exceed maxDepth', path: ['minDepth'] },
  );

export const CatalogEventSchema = z.object({
  id: z.string().min(1),
  source: SourceCodeSchema,
  sourceEventId: z.string().min(1),
  originTime: z.iso.datetime({ offset: true }),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  depthKm: z.number().nonnegative().nullable(),
  magnitude: z.number().nullable(),
  magnitudeType: z.string().nullable(),
  place: z.string().nullable(),
  revisionCount: z.number().int().nonnegative(),
});

export const EventsResponseSchema = z.object({
  meta: z.object({
    count: z.number().int().nonnegative(),
    source: z.array(SourceCodeSchema),
    freshness: z.object({
      AFAD: z.iso.datetime({ offset: true }).optional(),
      USGS: z.iso.datetime({ offset: true }).optional(),
      EMSC: z.iso.datetime({ offset: true }).optional(),
      ISC: z.iso.datetime({ offset: true }).optional(),
      GCMT: z.iso.datetime({ offset: true }).optional(),
    }),
  }),
  events: z.array(CatalogEventSchema),
});

export const SourceHealthEntrySchema = z.object({
  status: z.enum(['ok', 'delayed', 'error', 'never_synced']),
  lastAttemptAt: z.iso.datetime({ offset: true }).nullable(),
  lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
  latestEventTime: z.iso.datetime({ offset: true }).nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  lastRun: z
    .object({
      id: z.string().min(1),
      trigger: z.enum(['manual', 'scheduled']),
      windowKind: z.enum(['manual', 'bootstrap', 'incremental', 'reconcile']),
      windowStart: z.iso.datetime({ offset: true }),
      windowEnd: z.iso.datetime({ offset: true }),
      status: z.enum(['running', 'succeeded', 'failed']),
      startedAt: z.iso.datetime({ offset: true }),
      completedAt: z.iso.datetime({ offset: true }).nullable(),
      durationMs: z.number().int().nonnegative().nullable(),
      attempts: z.number().int().nonnegative(),
      fetched: z.number().int().nonnegative(),
      accepted: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
      duplicatesDropped: z.number().int().nonnegative(),
      inserted: z.number().int().nonnegative(),
      updated: z.number().int().nonnegative(),
      unchanged: z.number().int().nonnegative(),
      errorCode: z.string().nullable(),
    })
    .nullable(),
});

export const SourceHealthResponseSchema = z.object({
  AFAD: SourceHealthEntrySchema,
});

export const EventRevisionSchema = z.object({
  revisionNo: z.number().int().positive(),
  observedAt: z.iso.datetime({ offset: true }),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  originTime: z.iso.datetime({ offset: true }),
  latitude: z.number(),
  longitude: z.number(),
  depthKm: z.number().nullable(),
  magnitude: z.number().nullable(),
  magnitudeType: z.string().nullable(),
  place: z.string().nullable(),
});

export const EventDetailSchema = CatalogEventSchema.extend({
  sourceStatus: z.string().nullable(),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  firstSeenAt: z.iso.datetime({ offset: true }),
  lastSeenAt: z.iso.datetime({ offset: true }),
  revisions: z.array(EventRevisionSchema),
});

export const ServiceHealthSchema = z.object({
  service: z.literal('seismic-atlas-api'),
  status: z.literal('ok'),
  phase: z.literal(1),
  version: z.literal('0.4.0-alpha.0'),
  databaseBinding: z.literal('DB'),
  timestamp: z.iso.datetime({ offset: true }),
});

export type NormalizedSourceEvent = z.infer<typeof NormalizedSourceEventSchema>;
export type EventQuery = z.infer<typeof EventQuerySchema>;
export type CatalogEvent = z.infer<typeof CatalogEventSchema>;
export type EventsResponse = z.infer<typeof EventsResponseSchema>;
export type SourceHealthResponse = z.infer<typeof SourceHealthResponseSchema>;
export type EventRevision = z.infer<typeof EventRevisionSchema>;
export type EventDetail = z.infer<typeof EventDetailSchema>;
export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;
