export const CATALOG_RETENTION_MS = 7 * 24 * 60 * 60_000;

type RetentionResult = {
  cutoff: string;
  canonicalEventsDeleted: number;
  canonicalMembersDeleted: number;
  revisionsDeleted: number;
  eventsDeleted: number;
  rejectionsDeleted: number;
  inactiveSourceRunsDeleted: number;
};

function changes(result: D1Result<unknown> | undefined) {
  return Number(result?.meta.changes ?? 0);
}

export async function pruneRecentAfadCatalog(
  db: D1Database,
  now = Date.now(),
): Promise<RetentionResult> {
  const cutoff = now - CATALOG_RETENTION_MS;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE canonical_events
        SET preferred_source_event_pk = (
          SELECT member.source_event_pk
          FROM canonical_event_members member
          INNER JOIN source_events event ON event.id = member.source_event_pk
          WHERE member.canonical_event_id = canonical_events.id
            AND event.source = 'AFAD'
            AND event.origin_time >= ?
          ORDER BY event.origin_time DESC
          LIMIT 1
        )
        WHERE preferred_source_event_pk IN (
          SELECT id FROM source_events
          WHERE source != 'AFAD' OR origin_time < ?
        )`,
      )
      .bind(cutoff, cutoff),
    db
      .prepare(
        `DELETE FROM canonical_event_members
        WHERE source_event_pk IN (
          SELECT id FROM source_events
          WHERE source != 'AFAD' OR origin_time < ?
        )`,
      )
      .bind(cutoff),
    db.prepare(
      `DELETE FROM canonical_events
      WHERE preferred_source_event_pk IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM canonical_event_members member
          WHERE member.canonical_event_id = canonical_events.id
        )`,
    ),
    db
      .prepare(
        `DELETE FROM source_event_revisions
        WHERE source_event_pk IN (
          SELECT id FROM source_events
          WHERE source != 'AFAD' OR origin_time < ?
        )`,
      )
      .bind(cutoff),
    db
      .prepare(
        `DELETE FROM source_events
        WHERE source != 'AFAD' OR origin_time < ?`,
      )
      .bind(cutoff),
    db
      .prepare(
        `DELETE FROM ingestion_rejections
        WHERE source != 'AFAD' OR observed_at < ?`,
      )
      .bind(cutoff),
    db.prepare(`DELETE FROM ingestion_leases WHERE source != 'AFAD'`),
    db.prepare(`DELETE FROM ingestion_state WHERE source != 'AFAD'`),
    db.prepare(`DELETE FROM source_health WHERE source != 'AFAD'`),
    db.prepare(`DELETE FROM source_request_control WHERE source != 'AFAD'`),
    db.prepare(`DELETE FROM ingestion_runs WHERE source != 'AFAD'`),
  ]);

  return {
    cutoff: new Date(cutoff).toISOString(),
    canonicalMembersDeleted: changes(results[1]),
    canonicalEventsDeleted: changes(results[2]),
    revisionsDeleted: changes(results[3]),
    eventsDeleted: changes(results[4]),
    rejectionsDeleted: changes(results[5]),
    inactiveSourceRunsDeleted: changes(results[10]),
  };
}
