---
name: seismic-atlas-engineer-qa
description: Perform a senior full-stack release audit of Seismic Atlas across Worker/D1 behavior, API policy, security, resilience, performance, accessibility, and automated tests. Use for engineering sign-off or coverage review; not as a substitute for product or scientific acceptance.
---

# Seismic Atlas Engineer QA

Review the deployed-shape system, not only isolated TypeScript functions. Read [references/research.md](references/research.md) before testing.

## Engineering checks

- `F1 Reproducible gate`: clean typecheck, lint, full tests, production build, and an explicit code-coverage run.
- `F2 Runtime fidelity`: high-risk Worker/D1 paths are tested in a representative runtime or SQLite-backed integration; note Node-only gaps.
- `F3 API boundary`: events accept only AFAD and at most 168 hours; event detail is AFAD/recent-only; direct/cross-site catalog access is denied; CORS and cache headers match first-party intent.
- `F4 Ingestion safety`: bounded windows, pagination/saturation, validation, deduplication, revisions, cursor advancement, retries, lease/concurrency, circuit breaker, and failure behavior are covered.
- `F5 Retention`: current AFAD survives; old AFAD and all inactive-source events/revisions/canonical links are removed in foreign-key-safe order after successful synchronization.
- `F6 Scheduler/health`: production cron invokes AFAD only, retention runs, run/source health is truthful, and stale/missing cron states are distinguishable.
- `F7 Client resilience`: visible-tab polling, generation protection, multi-page consistency, loading/empty/error recovery, and Lab-only quality work are covered.
- `F8 Security/config`: no secrets are tracked; manual sync auth/rate limits, input validation, headers, error redaction, and dormant adapter isolation are checked.
- `F9 Performance/accessibility`: inspect production bundle warnings, map/worker cost, desktop/mobile rendering, keyboard/focus/status behavior, and lab Web Vitals without claiming field performance.
- `F10 Coverage meaning`: identify critical untested branches and integration seams; percentage alone cannot pass the audit.

## Method

Begin with read-only repository and git-state inspection. Run documented commands exactly; record versions and failures. Use focused adversarial requests for route boundaries and a real browser for one desktop and one mobile critical journey. Do not expose secrets, mutate remote systems, deploy, or fix findings during the audit. If a command requires unavailable infrastructure, mark it `BLOCKED` and provide the replay command.

Rate each check `PASS`, `PARTIAL`, `FAIL`, or `BLOCKED`. Distinguish a verified defect, a coverage gap, and an architectural risk.

## Output

Report environment/commit, commands and exit status, an `F1`–`F10` table, line/function/branch/statement coverage, critical-file coverage, findings with reproduction and smallest safe recommendation, limitations, and engineering release confidence. Include exact file paths for code evidence.
