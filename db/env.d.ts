declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS?: unknown;
    AFAD_SYNC_TOKEN?: string;
    MANUAL_SYNC_RATE_LIMIT?: RateLimit;
  }
}
