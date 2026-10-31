import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeEach } from 'vitest';

beforeEach(async () => {
  await applyD1Migrations(
    env.DB,
    env.TEST_MIGRATIONS as Parameters<typeof applyD1Migrations>[1],
  );
  await env.DB.batch([
    env.DB.prepare('DELETE FROM canonical_event_members'),
    env.DB.prepare('DELETE FROM canonical_events'),
    env.DB.prepare('DELETE FROM source_event_revisions'),
    env.DB.prepare('DELETE FROM ingestion_rejections'),
    env.DB.prepare('DELETE FROM source_events'),
    env.DB.prepare('DELETE FROM ingestion_leases'),
    env.DB.prepare('DELETE FROM ingestion_state'),
    env.DB.prepare('DELETE FROM source_health'),
    env.DB.prepare('DELETE FROM source_request_control'),
    env.DB.prepare('DELETE FROM ingestion_runs'),
  ]);
});
