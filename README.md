# Seismic Atlas

A map-first, provenance-aware seismic exploration workspace for Türkiye.

Phase 0 establishes the deployable application, Cloudflare Worker runtime, D1
schema, shared validation contracts, tests, and CI. The first Phase 1 slice adds
bounded AFAD ingestion, revision-aware storage, catalog APIs, source health, and
real earthquake markers on the 3D map. The atlas also renders 1,165 regional
active-fault segments from the open GEM Global Active Faults Database and shows
the nearest mapped segment as context for a selected earthquake.

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
overlapping 15-minute window and never removes previously stored events when the
upstream service is unavailable.

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
