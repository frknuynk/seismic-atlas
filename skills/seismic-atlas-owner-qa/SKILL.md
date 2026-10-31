---
name: seismic-atlas-owner-qa
description: Audit Seismic Atlas as the accountable product owner, validating user value, product boundaries, trust signals, and release readiness with browser evidence. Use for acceptance testing or a go/no-go review; not for code architecture review.
---

# Seismic Atlas Owner QA

Judge whether the current build delivers the product promised in `README.md`, not whether individual components merely render. Read [references/research.md](references/research.md) before testing.

## Test contract

Use current AFAD-backed local data. Inspect the default desktop experience and a compact mobile viewport. Do not change product code or test data during the audit. If the target or data is unavailable, mark the affected check `BLOCKED`; never infer a pass from source code alone.

Test these stable checks:

- `O1 Core value`: a first-time visitor can identify the product, see recent Türkiye seismicity, and open an event.
- `O2 Scope honesty`: seven-day scope, AFAD-only source, independent-product status, and non-warning/non-forecast boundary are discoverable and mutually consistent.
- `O3 Trust`: freshness, last synchronization, source health, attribution, and degraded-state language support an informed decision.
- `O4 Explore journey`: time range, magnitude/depth controls, map/timeline selection, event detail, and reset form one coherent reversible flow.
- `O5 Lab value`: Catalog Lab explains what subset it analyzes and provides useful analysis without export controls or causal/predictive overclaiming.
- `O6 Mobile value`: the primary event and Data Status journeys remain reachable, readable, and dismissible on a compact viewport.
- `O7 Release integrity`: no user-facing USGS/EMSC production claim, CSV/GeoJSON/Methods export, broken primary control, or contradictory version/status text remains.
- `O8 Failure communication`: available loading, empty, delayed/stale, and error states tell the user what happened and what remains usable. Do not manufacture destructive external failures.

## Evidence standard

For each check, record `PASS`, `PARTIAL`, `FAIL`, or `BLOCKED`, the exact observed evidence, viewport, and user impact. Exercise the real control chain; a visible label is not evidence that the flow works. Capture screenshots for desktop baseline, open event, Catalog Lab, and one mobile trust/detail state. Use semantic browser targets and keyboard-test the controls used in the primary journey.

## Output

Return:

1. environment and data timestamp;
2. an `O1`–`O8` results table;
3. passed journeys;
4. findings ordered `Blocker`, `High`, `Medium`, `Low`, each with reproduction and smallest safe recommendation;
5. untested/blocked scope;
6. a `GO`, `CONDITIONAL GO`, or `NO-GO` decision tied only to the evidence.

Do not dilute a failed product boundary with implementation quality, and do not turn preferences into defects.
