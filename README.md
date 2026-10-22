# Probe Harbor

[![CI](https://github.com/Dcastroro/probe-harbor/actions/workflows/ci.yml/badge.svg)](https://github.com/Dcastroro/probe-harbor/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Dcastroro/probe-harbor)](https://github.com/Dcastroro/probe-harbor/releases)
![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-43853d)
![npm dependencies: 0](https://img.shields.io/badge/npm_dependencies-0-blue)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Check service readiness with bounded network work and metadata-only reports.**

An application can return HTTP 200 before its workers are ready. Probe Harbor
checks expected statuses, media types and selected JSON values, retries transient
failures when requested, and gives CI a clear exit status. A deadline or exhausted
byte budget leaves every configured check accounted for.

No API keys, service accounts, authentication headers, cookie jar, query strings
or `.env` loading. Requests are GET/HEAD only. HTTPS verifies certificates; HTTP
is limited to literal loopback addresses. Redirects are never followed.

## Try the local demo

Requires Node.js 22+. Source releases are hosted on GitHub; the package is not
published to npm.

```sh
git clone https://github.com/Dcastroro/probe-harbor.git
cd probe-harbor
npm ci --ignore-scripts
npm run demo
```

The demo starts an ephemeral loopback server, checks three services and retries
one temporary 503. It closes its server afterwards and needs no external network
or credentials. The report includes IDs, status codes, timings and byte counts,
without copying endpoint URLs, headers or response bodies.

## Declare the checks

```json
{
  "version": 1,
  "checks": [
    {
      "id": "api-ready",
      "url": "http://127.0.0.1:3000/ready",
      "timeoutMs": 2000,
      "expectedStatus": [200],
      "assertions": [{ "pointer": "/status", "equals": "ready" }]
    },
    {
      "id": "web-alive",
      "url": "https://your-service.example/health",
      "method": "HEAD",
      "expectedStatus": [200, 204]
    }
  ]
}
```

Use your own endpoints. `your-service.example` is a placeholder; the runnable
demo uses only loopback. Keep local endpoint configuration outside a public
repository when its URLs are private.

```sh
# Offline validation: no DNS or HTTP requests
node bin/probe-harbor.mjs validate --config examples/probes.json

# After your services have started
node bin/probe-harbor.mjs run --config examples/probes.json --format json --concurrency 4 --deadline-ms 30000 --retries 1
```

Use `--format junit` on `run` to produce a JUnit XML report for a CI test-report
viewer. Each configured ID appears once, in input order; only the final outcome
counts as a failure. Cancelled/deadline checks, including queued checks that
never started, appear as failures. Reports contain IDs, fixed result codes and
times, without endpoint URLs, headers or bodies. Exit codes remain 0/1/2.
See [CI reporting](docs/ci.md#junit-test-reports) for file output and error handling.

| Field | Meaning |
| --- | --- |
| `id` | Unique lowercase report ID, up to 64 letters/digits/hyphens, starting with a letter. |
| `url` | Absolute HTTPS URL, or HTTP URL on `127.0.0.0/8` or `[::1]`; no userinfo, query or fragment. |
| `method` | `GET` (default) or `HEAD`. |
| `expectedStatus` | One to ten distinct expected HTTP codes from 200 to 599; default `[200]`. |
| `timeoutMs` | Per-attempt DNS/connect/response budget, 50–30,000 ms; default 2,000. |
| `maxBytes` | Observed response-body budget, 128–1,048,576 bytes; default 65,536. |
| `contentType` | Optional exact lowercase media type, ignoring response parameters such as charset. |
| `assertions` | Up to 16 JSON Pointer checks against primitive `equals` values. GET only. |

JSON assertions require `application/json` or an `application/*+json` response.
Pointer escapes `~0` and `~1` are supported; array indices are strict and prototype
properties are never traversed. Compressed JSON is rejected rather than inflated.
A single `identity` Content-Encoding token is accepted case-insensitively, following
[HTTP token semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4.1).
Compressed or stacked content codings remain unsupported.
Configuration is validated completely before any request starts.
The JavaScript API rejects sparse `checks`, `expectedStatus` and `assertions`
arrays, including missing entries supplied through an array prototype, with
`invalid-config`. Use dense arrays with an explicit value at every index.
This concerns JavaScript callers; JSON files cannot represent array holes.

## Use it from JavaScript

```js
import { runProbes, validateConfig } from './src/index.mjs';

validateConfig(config); // pure validation; fixed-code errors
const report = await runProbes(config, {
  concurrency: 4,
  deadlineMs: 30_000,
  retries: 1,
  totalBytes: 4_194_304,
  signal: abortController.signal
});
if (!report.healthy) process.exitCode = 1;
```

Results preserve input ID order. Each retains its bounded attempt history, so a
successful retry still shows the preceding failure. Reports intentionally expose
configured IDs, HTTP status codes, timings and counts; choose IDs suitable for logs.
See the [report contract and execution model](docs/architecture.md).

## CI behavior

To recheck selected services without editing the config, use
`run --only api-ready,web-alive` or pass `{ only: ['api-ready', 'web-alive'] }`
to `runProbes`. IDs are exact and case-sensitive, with no spaces or wildcards.
The nonempty selection must contain unique configured IDs. Unknown IDs fail
with `unknown-check`; malformed selections fail with `invalid-config`.

The full configuration is still validated before any request, including checks
outside the selection. Results retain configuration order; summary counts and
the healthy exit status describe only the selected checks. Global byte/deadline,
retry, TLS and concurrency rules still apply. Without `only`, all checks run.
Offline `validate` rejects `--only` and always validates the complete config.

| Exit | Meaning |
| --- | --- |
| `0` | Every check is healthy, or configuration validation succeeded. |
| `1` | At least one check is unhealthy, cancelled or uncompleted. |
| `2` | Invalid input or tool failure; never interpret this as a healthy run. |

Retries default to zero. Up to two retries are allowed for DNS/transport failures,
attempt timeouts, and unexpected 429/502/503/504 responses. Backoff is 100 ms then
200 ms, inside the same worker slot and global deadline. Other failed assertions
and HTTP statuses are not retried. An explicitly expected 503 is considered healthy.

The CLI handles SIGINT/SIGTERM as cancellation where the OS delivers those signals.
The library accepts `AbortSignal` on every supported platform. Queued checks receive
an explicit failure code when cancellation, deadline or byte exhaustion stops work.

[CI integration](docs/ci.md) · [Diagnostic codes](docs/diagnostics.md)

## Bounded operation

- Up to **1,000 checks**, with **1–32 workers**; default concurrency is 4.
- At most three attempts per check; no recursive polling or background monitoring.
- Global deadline: 50–120,000 ms; default 30,000.
- Aggregate observed body budget: up to 16 MiB; response headers: 16 KiB each.
- Only assertion bodies are buffered, within each check's body cap.
- Cancellable DNS, pinned address results and per-request connections that close.

The test suite includes 1,000 real loopback probes and checks the observed
concurrency, result order and complete accounting. This is a correctness regression,
not a distributed-monitoring or production throughput guarantee. Budget checks
stop processing on observed chunks; already received bytes can exceed a threshold.

Use operator-controlled configurations and authorized destinations. This is a
local readiness gate, not an HTTP proxy for untrusted URLs or a load-testing tool.
DNS uses cancellable A/AAAA queries through configured DNS servers rather than
the OS hosts-file resolver. See [security boundaries](SECURITY.md).

## Quality and delivery

```sh
npm run repo:check
npm run check
npm run demo
```

Windows/Ubuntu CI runs Node.js 22/24. Tests use temporary servers; TLS keys and
certificates are generated for each fixture rather than embedded in source.
Version tags trigger independently verified source releases with SHA-256 manifests
and an isolated publishing job using GitHub's ephemeral token.

[Validation](VALIDATION.md) · [Releasing](RELEASING.md) ·
[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

[Change Scope](https://github.com/Dcastroro/change-scope) selects affected projects;
[Task Relay](https://github.com/Dcastroro/task-relay) runs declared task graphs;
Probe Harbor checks the readiness of the services those workflows depend on.
