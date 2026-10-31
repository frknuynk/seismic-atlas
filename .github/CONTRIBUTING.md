# Contributing to Seismic Atlas

Thank you for helping improve Seismic Atlas. The project values small,
well-tested changes that preserve source provenance, scientific restraint, and
an accessible map experience.

## Before opening work

- Search existing issues and discussions first.
- Use an issue for a reproducible defect or scoped feature request.
- Use a discussion for an open-ended product, data, or scientific-method idea.
- Never include credentials, private data, or an unpatched vulnerability in a
  public issue. Follow [SECURITY.md](SECURITY.md) instead.

## Local setup

```bash
npm ci
npm run db:migrate:local
npm run sync:afad:local -- --minutes=10080
npm run dev
```

The AFAD synchronization requires network access. Stop the development server
before running the local sync command so both processes do not write to the
same local D1 database.

## Pull requests

1. Create a concise kebab-case branch.
2. Keep the change focused and update relevant tests and documentation.
3. Run `npm run check` before submitting.
4. Explain user impact, scientific/data implications, and verification in the
   pull request description.
5. Include before/after screenshots for visible interface changes.

Do not commit generated build output, local D1 state, secrets, or copied AFAD
catalog data. Changes must preserve AFAD attribution, the independent-product
disclaimer, third-party map attribution, and the seven-day catalog boundary.

## Scientific and product language

- Preserve source-reported magnitude types instead of treating ML and MW as
  interchangeable.
- Do not describe proximity as causation or label events as forecasts,
  warnings, mainshocks, or aftershocks without an explicitly reviewed method.
- Keep UTC/TRT labels and data freshness visible where they affect
  interpretation.

By participating, you agree to follow the project
[Code of Conduct](CODE_OF_CONDUCT.md).
