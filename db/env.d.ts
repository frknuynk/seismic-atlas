declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AFAD_SYNC_TOKEN?: string;
    MANUAL_SYNC_RATE_LIMIT?: RateLimit;
  }
}
