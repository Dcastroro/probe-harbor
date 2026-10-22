# Execution and report contract

One run validates the full configuration and options, creates a bounded worker
pool and returns one result for every selected ID, in configuration order.
Without the optional `only` list, every configured ID is selected. An explicit
list must contain 1–1,000 unique valid IDs, each an own array entry; unknown IDs
fail before DNS or HTTP starts. Even unselected checks undergo full validation.
Summary counts and health describe the selected run, not omitted checks.
Configuration URLs and assertions are copied into private execution state and
never added to reports. Configuration mutation during execution is unsupported.

Each worker owns a check across its attempts and backoff. Attempts resolve DNS,
connect, read a bounded complete response, evaluate status/MIME/JSON assertions
and close the connection. A failed status can be superseded by a body/transport
failure while reading the response; the reported code reflects completion safety.
HEAD requests carry no assertions and do not consume response-body data.

## Network behavior

GET/HEAD only; no redirects, custom request headers, request bodies, authentication,
cookie storage or loading of environment credentials. Requests use fixed Accept,
Accept-Encoding (`identity`) and User-Agent headers plus the required Host header.
Each request disables connection pooling, sets a 16 KiB response-header limit and
forces certificate verification. Runtime trust configuration remains Node's local
trust store, including intentionally installed extra CA certificates.
One-use agents bypass ambient proxy settings, so proxy credentials are not loaded.

Literal IP addresses skip DNS. Hostnames use an independent cancellable resolver
for A and AAAA queries. The first successful family starts a 25 ms collection
window for the other; outstanding queries are then cancelled. At most 16 addresses
per family are retained. Pinned results go to Node's family-selection connection
logic with a 100 ms family-attempt interval; the normal per-check timeout still
bounds the whole attempt. DNS results cannot cause a second implicit lookup.

This uses DNS servers rather than OS hosts-file or mDNS lookup. A family arriving
after the collection window is not tried. HTTPS retains the original hostname for
Host/SNI/certificate verification; this is not a generic DNS or routing diagnostic.
HTTP is restricted to literal IPv4 127/8 or IPv6 ::1. HTTPS may reach any explicitly
configured destination, including private networks; configurations are trusted
operator input, not an SSRF security boundary for a hosted service.

## Resource control

| Resource | Bound/default |
| --- | --- |
| Serialized UTF-8 configuration | 1 MiB |
| Checks / report IDs | 1–1,000; ID up to 64 ASCII characters |
| URL | Up to 2,048 characters |
| Workers | 1–32; default 4 |
| Retries per check | 0–2; default 0 |
| Attempt timeout | 50–30,000 ms; default 2,000 |
| Run deadline | 50–120,000 ms; default 30,000 |
| Body cap per attempt | 128 bytes–1 MiB; default 64 KiB |
| Aggregate observed body budget | 128 bytes–16 MiB; default 16 MiB |
| Response headers | 16 KiB per response |
| Assertions | Up to 16; pointer up to 256 characters/16 segments |
| Assertion expected value | null, boolean, finite number or string up to 256 characters |
| Expected statuses | 1–10 distinct codes between 200 and 599 |

Limits apply together. Body counters cover received payload chunks, excluding
headers/TLS framing. Data already delivered by the network can exceed a threshold
before cancellation takes effect. JSON buffers stay within the per-attempt cap;
other response bodies are counted but not retained. Compressed assertion bodies
are rejected and never decompressed.

A shared abort signal combines operator cancellation, deadline and aggregate
byte exhaustion. An attempt adds its own timeout. Timers/listeners are cleared,
DNS queries cancelled and client requests destroyed when work ends. Timers are
event-loop deadlines, not hard real-time CPU/OS preemption guarantees.

Retries only cover DNS/transport failures, attempt timeout, and unexpected
429/502/503/504. Backoff is 100/200 ms, consuming a worker slot. Retry-After is
not read, arbitrary server values cannot increase delays and cancelled/budgeted
work is never retried. No daemon or repeat schedule is created.

## Report schema

```json
{
  "version": 1,
  "ok": true,
  "healthy": true,
  "summary": { "checks": 1, "healthy": 1, "unhealthy": 0, "attempts": 1, "bytes": 18, "durationMs": 10 },
  "results": [{
    "id": "api-ready", "healthy": true, "code": "healthy",
    "attempts": [{ "code": "healthy", "statusCode": 200, "durationMs": 10, "bytes": 18 }]
  }]
}
```

`ok` means a valid run completed its accounting; `healthy` means every check
succeeded. Unhealthy counts include cancelled and unattempted checks. A queued
check can have an empty attempt list and `deadline`, `cancelled` or `byte-budget`.
A completed healthy check remains healthy if another check later exhausts a
budget. The result's final stop code can differ from the last attempt when
cancellation arrives during retry backoff. Durations include DNS/connect/body
work; summary time also includes queuing and backoff.

Input/operation exceptions produce `ok: false` and a fixed error code in the CLI.
The library throws `HarborError` for handled validation failures. Reports do not
include URLs, hostname/IP strings, paths, headers, bodies, assertion values,
raw network errors or abort reasons. IDs, numeric statuses, counts and timings
are intentionally public report fields. Ordinary library stack traces, external
instrumentation, DNS/network access logs and Node debug flags are caller-controlled.

References: [Node HTTP](https://nodejs.org/docs/latest-v22.x/api/http.html),
[Node HTTPS](https://nodejs.org/docs/latest-v22.x/api/https.html),
[DNS cancellation](https://nodejs.org/docs/latest-v22.x/api/dns.html),
[family selection](https://nodejs.org/docs/latest-v22.x/api/net.html).
