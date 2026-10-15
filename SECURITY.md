# Security boundaries

Probe Harbor embeds no credentials and requires no service account. Request
configuration has no authentication/header/body fields. URL userinfo, query
strings and fragments are rejected. Cookies are not stored or resent; no `.env`
file or environment credential is loaded into requests. Methods are GET/HEAD.

HTTPS verifies certificates even if an ambient insecure TLS default is present.
HTTP is restricted to literal IPv4 loopback 127/8 or IPv6 ::1. Redirects and
protocol upgrades are not followed; the latter's socket is destroyed. DNS results
are bounded, pinned for each attempt and cancellable. Network errors, response
headers/bodies, raw URLs and cancellation reasons never enter application reports.
Report IDs, HTTP codes and timings remain visible by design.

Network requests reach operator-selected destinations and their DNS servers.
HTTPS can address private networks; use configurations and networks you control.
This library is not an SSRF-safe public URL-fetching service or a load generator.
A URL path can itself carry private data: keep operational configuration outside
public source control and do not put credentials into paths. An endpoint's GET
semantics remain under its owner's control, including behavior during retries.

Body/header/concurrency/attempt/deadline limits are enforced together. Body
counters cover observed chunks, so already received bytes can exceed a threshold
as cancellation takes effect. Compressed JSON is rejected, not decompressed.
All configured checks are validated before networking starts; failed or unfinished
checks cannot silently become healthy results.

The caller controls runtime trust stores, Node flags, DNS configuration and external
instrumentation. Metadata-only describes the tool's reports, not infrastructure
access logs or Node's optional internal network debugging. Offline config symlinks
are rejected; concurrent filesystem mutation and hostile runtime instrumentation
are outside a sandbox guarantee. Library stack-trace display remains caller-controlled.

TLS tests generate ephemeral key material in memory; no test private key is stored
in the repository. A temporary public test CA is used only by a child process.
Repository secret-pattern checks are heuristics, not proof that all possible
secrets are recognized. Report vulnerabilities through the contact channel linked
on the maintainer's GitHub profile using a minimal fictional reproduction. Avoid
posting credentials, private endpoints, request traces or raw response bodies.
