# Changelog

## 0.1.1 — 2026-10-15

- Accept case-insensitive identity content coding on JSON assertion responses.
- Preserve rejection of compressed and stacked codings, fixed diagnostics and no retries for encoding failures.
- Cover mixed-case tokens and coding stacks with real loopback HTTP tests.

## 0.1.0 — 2026-10-15

- GET/HEAD HTTP/HTTPS readiness checks with exact status/media type expectations.
- Bounded JSON Pointer assertions with no copied response values in reports.
- Worker-limited concurrency, explicit transient retries and complete result ordering.
- Attempt/run deadlines, aggregate/body/header budgets and portable library cancellation.
- Cancellable dual-family DNS with pinned results and verified TLS connections.
- Rejected credential-bearing URLs, query strings, redirects and custom authentication.
- CLI validation, text/JSON reports and meaningful health/input failure exit statuses.
- Self-contained demo, 1,000-probe loopback regression and generated TLS fixtures.
- Cross-platform CI and checksum-verified source releases with isolated publication.
