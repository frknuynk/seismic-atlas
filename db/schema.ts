import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const sourceEvents = sqliteTable(
  'source_events',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    sourceEventId: text('source_event_id').notNull(),
    originTime: integer('origin_time').notNull(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    depthKm: real('depth_km'),
    magnitude: real('magnitude'),
    magnitudeType: text('magnitude_type'),
    placeRaw: text('place_raw'),
    eventType: text('event_type'),
    sourceStatus: text('source_status'),
    h3R4: text('h3_r4'),
    h3R5: text('h3_r5'),
    h3R6: text('h3_r6'),
    h3R7: text('h3_r7'),
    provinceCode: text('province_code'),
    sourceUpdatedAt: integer('source_updated_at'),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    payloadHash: text('payload_hash').notNull(),
  },
  (table) => [
    uniqueIndex('uq_events_source_event').on(
      table.source,
      table.sourceEventId,
    ),
    index('idx_events_time').on(table.originTime),
    index('idx_events_source_time').on(table.source, table.originTime),
    index('idx_events_mag_time').on(table.magnitude, table.originTime),
    index('idx_events_h3_r5').on(table.h3R5),
    index('idx_events_h3_r6').on(table.h3R6),
  ],
);

export const sourceEventRevisions = sqliteTable(
  'source_event_revisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceEventPk: text('source_event_pk')
      .notNull()
      .references(() => sourceEvents.id),
    revisionNo: integer('revision_no').notNull(),
    payloadHash: text('payload_hash').notNull(),
    observedAt: integer('observed_at').notNull(),
    sourceUpdatedAt: integer('source_updated_at'),
    originTime: integer('origin_time').notNull(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    depthKm: real('depth_km'),
    magnitude: real('magnitude'),
    magnitudeType: text('magnitude_type'),
    placeRaw: text('place_raw'),
    rawJson: text('raw_json'),
  },
  (table) => [
    uniqueIndex('uq_revisions_event_payload').on(
      table.sourceEventPk,
      table.payloadHash,
    ),
    index('idx_revisions_event_observed').on(
      table.sourceEventPk,
      table.observedAt,
    ),
  ],
);

export const sourceHealth = sqliteTable('source_health', {
  source: text('source').primaryKey(),
  lastAttemptAt: integer('last_attempt_at'),
  lastSuccessAt: integer('last_success_at'),
  latestEventTime: integer('latest_event_time'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  status: text('status').notNull(),
});

export const ingestionState = sqliteTable('ingestion_state', {
  source: text('source').primaryKey(),
  lastSuccessWindowEnd: integer('last_success_window_end'),
  lastFullReconcileAt: integer('last_full_reconcile_at'),
  adapterVersion: text('adapter_version').notNull(),
});
