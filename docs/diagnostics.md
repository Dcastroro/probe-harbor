# Diagnostic codes

CLI input/tool errors exit `2` and use JSON even in text or JUnit mode:

```json
{"version":1,"ok":false,"error":{"code":"invalid-url"}}
```

| Input code | Action |
| --- | --- |
| `usage` | Check command flags, format and nonnegative integer syntax. |
| `config-file` | Supply a readable regular file with no linked path components, within 1 MiB. |
| `config-limit` | Reduce serialized configuration size. |
| `invalid-json` | Supply valid UTF-8 JSON. |
| `invalid-config` | Check version, allowed fields, unique IDs, methods, bounds, statuses and primitive assertions. JavaScript arrays must have an own value at every index; sparse arrays are rejected. |
| `invalid-url` | Use an absolute credential-free HTTPS URL, or HTTP on literal loopback; remove query/fragment/userinfo. |
| `internal-error` | Stop the pipeline and provide a minimal fictional reproduction. |

A valid run exits `0` only when all checks are healthy; otherwise it exits `1`.
Its result/attempt codes are:

| Result code | Meaning |
| --- | --- |
| `healthy` | All configured expectations passed. |
| `dns-failed` | Cancellable DNS queries did not yield a usable address. |
| `request-failed` | Connect/TLS/protocol/header/body transport failure; raw error is suppressed. |
| `timeout` | The attempt's DNS/connect/response timer expired. |
| `deadline` | The global run deadline stopped current or queued work. |
| `cancelled` | Operator/library cancellation, without copying its reason. |
| `byte-budget` | Aggregate observed response-body bytes exhausted the run budget. |
| `body-limit` | This attempt exceeded its observed response-body cap. |
| `unexpected-status` | Received a status outside the configured expected list. |
| `unexpected-content-type` | Media type did not match the explicit expectation or JSON assertion requirement. |
| `unsupported-encoding` | An assertion response used a content encoding other than identity. |
| `invalid-json` | Assertion body was not valid UTF-8 JSON. |
| `assertion-failed` | A pointer was absent, invalid for an array, or did not equal its expected primitive. |
| `unsupported-upgrade` | A protocol upgrade was refused and its socket closed. |

Raw URLs, response values and network errors are intentionally absent. Investigate
the affected ID in a controlled local environment. Use private operational logs
for endpoint details; avoid pasting private configuration into public issues.
