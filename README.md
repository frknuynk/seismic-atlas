# Seismic Atlas

A map-first, provenance-aware seismic exploration workspace for Türkiye.

Current development version: **0.4.0-alpha.1**.

Phase 0 establishes the deployable application, Cloudflare Worker runtime, D1
schema, shared validation contracts, tests, and CI. The first Phase 1 slice adds
bounded AFAD ingestion, revision-aware storage, catalog APIs, source health, and
real earthquake markers on the 3D map. The atlas also renders 1,165 regional
active-fault segments from the open GEM Global Active Faults Database and shows
the nearest mapped segment as context for a selected earthquake. A synchronized
timeline filters the map by time bucket, and current-view search locates stored
events by place, magnitude, or AFAD event ID.

The first v0.4 reliability slice adds bounded retry and timeout handling for
AFAD, per-record quarantine for malformed upstream rows, deterministic
within-batch deduplication, a D1-backed synchronization lease, and durable run
diagnostics. Concurrent triggers no longer perform overlapping ingestion work,
and the source-health response reports the latest run counters and failure code.
Scheduled runs resume from the last successful cursor with overlap, recover gaps
up to 24 hours, and perform a seven-day reconciliation every day to capture late
AFAD revisions. Up to 25 malformed source records per run are preserved in a
separate quarantine table for diagnosis and never enter the earthquake catalog.
Responses that reach AFAD's 2,500-record ceiling are recursively split into
smaller overlapping time windows and deduplicated across the boundary. If a
one-second window is still saturated, ingestion fails without advancing its
cursor rather than silently accepting incomplete data.

The `afad-v3` persistence path loads existing source hashes once, then writes
events and revisions with JSON-backed transactions of up to 1,000 events. Long
runs renew their D1 lease, a replaced lease fences the old worker before it can
write, and a new owner marks abandoned `running` records as failed. The source
health audit includes the number of database write batches used by each run.

## Requirements

- Node.js 22.13 or newer
- npm 10 or newer
- Tippecanoe 2.79 or newer (only when rebuilding fault tiles)

## Local development

```bash
npm install
npm run db:migrate:local
npm run dev
```

The development server prints its local URL. The API foundation is available at
`/api/v1/health`.

Run a first local AFAD synchronization with:

```bash
curl -X POST http://localhost:3000/api/v1/internal/sync/afad
```

The production route requires `AFAD_SYNC_TOKEN`. Scheduled ingestion uses an
overlapping cursor window of at least 15 minutes and never removes previously
stored events when the upstream service is unavailable.

Successful synchronization responses include a run ID, attempt and saturation
split counts, accepted and rejected row counts, duplicate count, insert/update
totals, and duration.
When another synchronization already owns the AFAD lease, the second trigger is
reported as `skipped` with reason `sync_in_progress`.

## Validation

```bash
npm run check
```

This runs type checking, linting, unit tests, and the production build.

## Database migrations

Change `db/schema.ts`, then generate and inspect a migration:

```bash
npm run db:generate
npm run db:migrate:local
```

Production database identifiers are intentionally not committed during Phase 0.
The logical binding is `DB`, declared in `.openai/hosting.json`.

## Fault dataset

The checked-in browser assets under `public/data/faults/` are a Türkiye-region
derivative of GEM Global Active Faults, licensed CC BY-SA 4.0.

- Source: https://github.com/GEMScienceTools/gem-global-active-faults
- Source file: `geojson/gem_active_faults.geojson`
- Source revision: `56816508ad92fd6846dad1163b1c8c01376a2cd1`
- Source SHA-256: `603513086b4693de6008e3444959995c34683b30dac291856340522a76d8505e`
- Processed: 2026-09-06
- Attribution: © GEM Foundation contributors

The source was clipped to `22°E–47°E, 33°N–44°N`, coordinate precision was
reduced to five decimal places, unused attributes were removed, and the result
was tiled as PMTiles. No geological interpretation or fault-to-earthquake
association was added. This regional context is not suitable for site-specific
engineering or hazard decisions.

To reproduce the derivative, download the pinned upstream GeoJSON to
`data/raw/gem_active_faults.geojson`, install Tippecanoe, then run:

```bash
npm run data:build:faults
```

## Architecture

- React 19 on Vinext/Vite
- Cloudflare Workers runtime
- Hono API router
- Cloudflare D1 with Drizzle migrations
- MapLibre GL JS
- Zod contracts shared across browser and Worker code
- Vitest, Oxlint, TypeScript, and GitHub Actions
