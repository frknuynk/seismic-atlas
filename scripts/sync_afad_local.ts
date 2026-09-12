import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runAfadSync } from '@/worker/ingestion/afad';

type BoundStatement = {
  sql: string;
  bindings: SQLInputValue[];
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
};

const DEFAULT_WINDOW_MINUTES = 15;
const MIN_WINDOW_MINUTES = 15;
const MAX_WINDOW_MINUTES = 7 * 24 * 60;
const LOCAL_D1_DIRECTORY = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

function valueForArgument(name: string) {
  const prefix = `--${name}=`;
  const argument = process.argv
    .slice(2)
    .find((item) => item.startsWith(prefix));
  return argument?.slice(prefix.length);
}

function windowMinutes() {
  const rawValue = valueForArgument('minutes');
  if (rawValue === undefined) return DEFAULT_WINDOW_MINUTES;

  const value = Number(rawValue);
  if (
    !Number.isInteger(value) ||
    value < MIN_WINDOW_MINUTES ||
    value > MAX_WINDOW_MINUTES
  ) {
    throw new Error(
      `--minutes must be an integer from ${MIN_WINDOW_MINUTES} to ${MAX_WINDOW_MINUTES}.`,
    );
  }
  return value;
}

function localDatabasePath() {
  const explicitPath = valueForArgument('database');
  if (explicitPath) return resolve(explicitPath);

  const directory = resolve(LOCAL_D1_DIRECTORY);
  let candidates: string[];
  try {
    candidates = readdirSync(directory)
      .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
      .map((name) => resolve(directory, name));
  } catch (error) {
    throw new Error(
      'Local D1 state was not found. Run `npm run db:migrate:local` first.',
      { cause: error },
    );
  }

  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? 'No local D1 database was found. Run `npm run db:migrate:local` first.'
        : 'More than one local D1 database was found. Select one with --database=/absolute/path.sqlite.',
    );
  }
  return candidates[0];
}

function d1Adapter(sqlite: DatabaseSync) {
  const bound = (sql: string, bindings: unknown[]): BoundStatement => ({
    sql,
    bindings: bindings as SQLInputValue[],
    async all<T>() {
      return {
        results: sqlite.prepare(sql).all(...this.bindings) as T[],
      };
    },
    async first<T>() {
      return (
        (sqlite.prepare(sql).get(...this.bindings) as T | undefined) ?? null
      );
    },
    async run() {
      const result = sqlite.prepare(sql).run(...this.bindings);
      return { meta: { changes: Number(result.changes) } };
    },
  });

  return {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return bound(sql, bindings);
        },
      };
    },
    async batch(statements: BoundStatement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
}

const databasePath = localDatabasePath();
const sqlite = new DatabaseSync(databasePath);
sqlite.exec('PRAGMA busy_timeout = 5000');

try {
  const result = await runAfadSync(d1Adapter(sqlite), {
    now: new Date(),
    windowMinutes: windowMinutes(),
    trigger: 'manual',
  });
  console.log(JSON.stringify({ databasePath, ...result }, null, 2));
} finally {
  sqlite.close();
}
