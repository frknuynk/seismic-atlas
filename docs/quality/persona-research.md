# Seismic Atlas Persona QA Research

Research date: 2026-10-31

This document records the evidence used to define the four project-specific QA
skills under `skills/`. It is a test-basis document, not a claim of formal
accessibility, scientific, security, or Scrum certification.

## 1. Accountable product owner

The official [Scrum Guide](https://scrumguides.org/scrum-guide.html) frames a
product as a vehicle for value with a clear boundary, stakeholders, and users,
and makes the Product Owner accountable for value and transparent goals. For
Seismic Atlas this means acceptance cannot stop at “the map renders.” It must
prove the AFAD-only, rolling-seven-day, map-first promise; user trust; mobile
reachability; and honest release boundaries.

Test emphasis: end-to-end value, consistency with `README.md`, freshness and
failure communication, non-official/non-warning positioning, removal of export
and inactive-source surfaces, and a defensible go/no-go decision.

## 2. Curious earthquake enthusiast

The [USGS Latest Earthquakes map help](https://earthquake.usgs.gov/earthquakes/map/?about=true)
uses a recognizable public pattern: magnitude affects marker size, event age
affects color, and map/list selection stays synchronized. AFAD's
[magnitude and intensity explainer](https://www.afad.gov.tr/kurumlar/afad.gov.tr/39500/xfiles/deprem_nedir.pdf)
distinguishes source energy from observed effects. USGS also explains that
[magnitudes can differ and be revised](https://www.usgs.gov/faqs/why-do-usgs-earthquake-magnitudes-differ-those-published-other-agencies).

The usability basis also includes WCAG 2.2 guidance for
[keyboard and predictable focus](https://www.w3.org/WAI/WCAG22/quickref/),
[visible/unobscured focus](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/),
and [status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

Test emphasis: rapid answers to where/when/how large, understandable units and
time/source context, reversible filters, mobile task completion, keyboard
operation, and no accidental hazard, intensity, forecast, or official-service
claim.

## 3. Geology engineer

The [AFAD Event Web Service](https://deprem.afad.gov.tr/event-service) defines
the upstream time, position, depth, magnitude-type, ordering, pagination, and
event-ID contract. [USGS magnitude-type documentation](https://www.usgs.gov/programs/earthquake-hazards/magnitude-types)
shows why ML, mb, Mw, Md, and related values are method-dependent rather than
interchangeable. USGS catalog methodology describes the need to consider
[completeness, declustering, magnitude conversion, and uncertainty](https://pubs.usgs.gov/of/2015/1070/pdf/ofr2015-1070.pdf)
before stronger seismicity or hazard inference.

Test emphasis: observation fidelity, provenance and revision history, retained
magnitude types, explicit seven-day/subset boundaries, honest completeness and
sequence methods, reproducibility, and a strict separation between nearest
[GEM fault](https://github.com/GEMScienceTools/gem-global-active-faults)
proximity and causation.

## 4. Senior full-stack engineer

[Cloudflare Workers testing guidance](https://developers.cloudflare.com/workers/testing/)
recommends complementary Worker-runtime unit tests and whole-system integration
tests; its [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
can exercise real runtime APIs and bindings. [OWASP ASVS](https://asvs.owasp.org/)
provides a repeatable security verification basis. Cloudflare's
[cache behavior](https://developers.cloudflare.com/workers/cache/) and Google's
[Core Web Vitals](https://web.dev/articles/vitals) provide response-policy and
user-centric performance criteria.

Test emphasis: the complete AFAD ingestion → D1 → same-origin API → browser
chain; retention and scheduling; auth/input/cache boundaries; runtime fidelity;
resilience; bundle and browser behavior; numeric coverage; and the critical
untested seams hidden by an aggregate percentage.

## Resulting skills

| Persona | Skill | Stable check IDs |
| --- | --- | --- |
| Product owner | `seismic-atlas-owner-qa` | `O1`–`O8` |
| Earthquake enthusiast | `seismic-atlas-enthusiast-qa` | `E1`–`E8` |
| Geology engineer | `seismic-atlas-geologist-qa` | `G1`–`G9` |
| Senior full-stack engineer | `seismic-atlas-engineer-qa` | `F1`–`F10` |

All four skills require observable evidence and the same result vocabulary:
`PASS`, `PARTIAL`, `FAIL`, or `BLOCKED`. This makes cross-persona coverage
aggregatable without pretending the personas have identical priorities.
