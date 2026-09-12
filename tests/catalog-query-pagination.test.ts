import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { EventQuerySchema, EventsResponseSchema } from '@/shared/schemas';
import { queryEvents } from '@/worker/catalog';

function sqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of [
    '0000_wild_champions.sql',
    '0001_lame_lilith.sql',
    '0002_faulty_king_bedlam.sql',
    '0003_needy_shiver_man.sql',
    '0004_free_saracen.sql',
    '0005_round_firestar.sql',
  ]) {
    sqlite.exec(
      readFileSync(
        new URL(`../migrations/${migration}`, import.meta.url),
        'utf8',
      ),
    );
  }

  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            async all<T>() {
              return {
                results: sqlite
                  .prepare(sql)
                  .all(...(bindings as SQLInputValue[])) as T[],
              };
            },
            async first<T>() {
              return (
                (sqlite.prepare(sql).get(...(bindings as SQLInputValue[])) as
                  | T
                  | undefined) ?? null
              );
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, sqlite };
}

let activeDatabase: DatabaseSync | null = null;

afterEach(() => {
  activeDatabase?.close();
  activeDatabase = null;
});

describe('D1 catalog keyset pagination', () => {
  it('returns every event exactly once across a 2,500-record boundary', async () => {
    const database = sqliteD1();
    activeDatabase = database.sqlite;
    const insert = database.sqlite.prepare(
      `INSERT INTO source_events (
        id, source, source_event_id, origin_time, latitude, longitude,
        depth_km, magnitude, magnitude_type, place_raw, first_seen_at,
        last_seen_at, payload_hash
      ) VALUES (?, 'AFAD', ?, ?, 39, 35, 7, 2.1, 'ML', 'Türkiye', 1, 1, ?)`,
    );
    const originTime = Date.parse('2026-09-09T12:00:00.000Z');

    database.sqlite.exec('BEGIN');
    for (let index = 0; index < 2_505; index += 1) {
      const sourceId = `event-${index.toString().padStart(4, '0')}`;
      insert.run(`AFAD:${sourceId}`, sourceId, originTime, `hash-${index}`);
    }
    database.sqlite.exec('COMMIT');

    const ids: string[] = [];
    let cursor: string | undefined;
    let page = 0;
    do {
      const response = EventsResponseSchema.parse(
        await queryEvents(
          database.db,
          EventQuerySchema.parse({
            start: '2026-09-09T00:00:00.000Z',
            end: '2026-09-10T00:00:00.000Z',
            limit: 1_000,
            cursor,
          }),
        ),
      );
      page += 1;
      ids.push(...response.events.map((item) => item.id));
      expect(response.meta.total).toBe(2_505);
      expect(response.meta.returned).toBe(response.events.length);
      cursor = response.meta.nextCursor ?? undefined;
      if (!response.meta.hasMore) break;
    } while (cursor);

    expect(page).toBe(3);
    expect(ids).toHaveLength(2_505);
    expect(new Set(ids)).toHaveLength(2_505);
    expect(ids[0]).toBe('AFAD:event-2504');
    expect(ids.at(-1)).toBe('AFAD:event-0000');
  });

  it('rejects a malformed cursor instead of returning an arbitrary page', async () => {
    const database = sqliteD1();
    activeDatabase = database.sqlite;

    await expect(
      queryEvents(
        database.db,
        EventQuerySchema.parse({
          start: '2026-09-09T00:00:00.000Z',
          end: '2026-09-10T00:00:00.000Z',
          cursor: 'valid_characters_but_not_a_cursor',
        }),
      ),
    ).rejects.toMatchObject({ name: 'InvalidCatalogCursorError' });
  });
});
