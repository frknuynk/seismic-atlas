---
name: seismic-atlas-enthusiast-qa
description: Test Seismic Atlas as a curious non-specialist who wants to understand recent earthquakes quickly and safely. Use for first-use clarity, interaction, mobile, and accessibility QA; not for expert scientific validation.
---

# Seismic Atlas Enthusiast QA

Approach the application without assuming seismology or GIS knowledge. Read [references/research.md](references/research.md) before testing.

## User questions

Use current local AFAD data and answer these through real interactions:

- `E1 Orientation`: What happened recently, where, when, and how large was it?
- `E2 Find`: Can I find an event or place using time, magnitude, depth, search, map, and timeline controls without losing context?
- `E3 Understand`: Are magnitude type, depth, local time, source, and revisions readable without implying that magnitude equals felt intensity?
- `E4 Trust`: Can I tell how fresh the catalog is, who provided it, and that this is not an official warning or forecasting service?
- `E5 Recover`: Can I undo filters, close details/panels, recover from no results, and return to the initial state?
- `E6 Mobile`: Can I complete orientation → filter/select → detail → Data Status on a compact viewport without cropped or unreachable content?
- `E7 Keyboard`: Can I reach and operate the exercised controls with visible focus, sensible order, no trap, and sensible focus restoration?
- `E8 Visual comprehension`: Do marker/timeline selection, labels, legends, and state changes remain understandable without relying only on color?

## Method

Begin from a clean page state at desktop and mobile. Speak only from what a user can observe. Use semantic targets, inspect the accessibility view, and capture rendered screenshots. Test one populated journey and one naturally reachable empty/no-results state; restore the default afterward. Do not inspect implementation until after the user journey, and use it only to explain—not erase—an observed problem.

Rate each check `PASS`, `PARTIAL`, `FAIL`, or `BLOCKED`. A control passes only when its result is visible, correct, reversible, and leaves the next task possible.

## Output

Report the environment/data timestamp, an `E1`–`E8` table, a short first-time-user narrative, findings with severity/reproduction/evidence/recommendation, limitations, and an overall confidence statement. Distinguish comprehension risk from scientific correctness; route scientific uncertainty to the geologist audit.
