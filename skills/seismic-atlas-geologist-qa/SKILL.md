---
name: seismic-atlas-geologist-qa
description: Audit Seismic Atlas for seismological and geological integrity, provenance, reproducibility, and honest uncertainty. Use when validating catalog semantics, fault context, Catalog Lab, or sequence analysis; not for formal hazard assessment.
---

# Seismic Atlas Geologist QA

Evaluate whether the application preserves the meaning and limitations of its source observations. Read [references/research.md](references/research.md) before testing.

## Scientific checks

- `G1 Observation fidelity`: origin time/time zone, latitude, longitude, depth in km, magnitude value/type, location, source ID, and source are internally consistent from catalog to detail.
- `G2 Provenance and revision`: AFAD attribution, source link/ID, revision history, ingestion time, and freshness distinguish an observation from the app's processing.
- `G3 Magnitude semantics`: magnitude types are retained; the UI does not silently normalize, compare unlike types as exact equivalents, or call magnitude intensity.
- `G4 Catalog boundary`: the rolling seven-day and current-map/filter subset is explicit wherever completeness or distributions are interpreted.
- `G5 Completeness`: completeness estimates expose method, sample limitations, and insufficient-data states; they are not presented as universal catalog truth.
- `G6 Sequence method`: sequence candidates expose spatial/temporal thresholds, remain reproducible, and avoid declaring mainshock/aftershock, causation, or forecast.
- `G7 Fault context`: nearest GEM mapped segment is described as proximity only, not rupture attribution; distance units and absent/out-of-range states are honest.
- `G8 Visual encoding`: magnitude, depth, time, selection, and fault layers use legible units/legends and do not suggest more spatial precision than the data warrants.
- `G9 Analytical consistency`: counts and selected subsets agree across map, timeline, Lab, and detail within documented filters and pagination boundaries.

## Method

Use a populated current-data state. Inspect at least three events spanning available magnitude/depth values and one Catalog Lab/Sequence Inspector candidate if present. Cross-check representative UI fields against the app API or local D1 with read-only queries. Record the exact query/ID used. Treat a seven-day sample as exploratory; do not attempt hazard, recurrence, b-value, or causal conclusions beyond the implemented methods.

Rate each check `PASS`, `PARTIAL`, `FAIL`, or `BLOCKED`. Separate data-source limitations from application defects, and separate scientific misuse from missing convenience.

## Output

Report environment/catalog bounds, a `G1`–`G9` table, event IDs sampled, reproducibility evidence, findings ordered by scientific/user impact, source-data limitations, and a scientific-use confidence statement: `EXPLORATORY-SAFE`, `SAFE WITH CAVEATS`, or `MISLEADING`.
