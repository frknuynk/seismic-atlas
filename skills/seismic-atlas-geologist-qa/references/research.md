# Geoscience research basis

## Evidence

- The [AFAD Event Web Service contract](https://deprem.afad.gov.tr/event-service) defines source filters and output fields for time, bounds, depth, magnitude type, ordering, offset, and event ID.
- [USGS magnitude-type documentation](https://www.usgs.gov/programs/earthquake-hazards/magnitude-types) shows that ML, mb, Mw, Md, and other types have different methods and applicable ranges; they are not interchangeable labels.
- [USGS on magnitude differences and revisions](https://www.usgs.gov/faqs/why-do-usgs-earthquake-magnitudes-differ-those-published-other-agencies) explains inherent uncertainty and why preferred values change as methods or data change.
- USGS catalog methodology emphasizes [catalog completeness, declustering, magnitude conversion, and model uncertainty](https://pubs.usgs.gov/of/2015/1070/pdf/ofr2015-1070.pdf) before using a catalog for seismicity or hazard inference.
- The checked-in fault layer comes from the [GEM Global Active Faults Database](https://github.com/GEMScienceTools/gem-global-active-faults) and is regional context; proximity alone does not establish a causative fault.

## Project-specific interpretation

Seismic Atlas is a seven-day exploratory viewer, not a hazard model. Catalog Lab may describe the verified subset and proximity-based candidates, but it must preserve magnitude types, surface method/sample limits, and avoid causal labels. Nearest-fault output is useful only with a conspicuous proximity caveat and source attribution.
