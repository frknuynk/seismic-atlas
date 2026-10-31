# Senior full-stack research basis

## Evidence

- [Cloudflare Workers testing guidance](https://developers.cloudflare.com/workers/testing/) recommends Worker-runtime unit tests and whole-system integration harnesses as complementary layers. The [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/) provides runtime APIs, bindings, and isolated storage; Node-only tests cannot prove full Worker compatibility.
- [OWASP ASVS](https://asvs.owasp.org/) provides a consistent basis for web application security verification rather than ad hoc vulnerability checks.
- [Cloudflare cache documentation](https://developers.cloudflare.com/workers/cache/) follows HTTP cache semantics and limits cache eligibility to GET/HEAD fetch paths; catalog privacy intent must therefore be verified in response headers and routing behavior.
- [Core Web Vitals](https://web.dev/articles/vitals) defines LCP, INP, and CLS as user-centric loading, responsiveness, and visual-stability measures. Lab tests are useful for regressions but do not replace field data.
- WCAG guidance covers [keyboard operation and predictable focus](https://www.w3.org/WAI/WCAG22/quickref/), [focus visibility](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/), and [status announcements](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

## Project-specific interpretation

The highest-risk seams are AFAD upstream ingestion → validation/revision/cursor state → D1 retention/query → same-origin app routes → polling and analysis workers. A strong unit percentage does not compensate for an untested route, scheduled handler, binding, migration, or browser journey. Report both numeric coverage and requirement coverage.
