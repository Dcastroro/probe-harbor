# Validation evidence

The local suite is exercised on Windows/Node.js 24.20.0. GitHub CI validates
Windows/Ubuntu with Node.js 22/24, with live runs linked from the README. Version
tags independently run the matrix before packaging and publication.

- All input fields and option bounds are validated before any network operation.
- Status/MIME/JSON assertions and strict pointer escaping/array/prototype handling.
- Response body, header, malformed/encoded payload and aggregate byte boundaries.
- Transient retry history and non-retried ordinary status/assertion failures.
- Unfollowed redirects, rejected upgrades, no cookie/auth forwarding and value-free errors.
- Attempt timeout, run deadline, queued work, early/in-flight cancellation and sanitized reasons.
- Cancellable DNS failure and bounded dual-family address pinning.
- Trusted HTTPS using runtime-generated TLS keys/certificates, with no embedded private key.
- Untrusted certificates remain rejected under an insecure ambient TLS default.
- 1,000 real loopback checks: concurrency stays within eight workers, all results remain
  ordered and exactly 1,000 attempts are accounted for.
- CLI success/unhealthy/input-error exit statuses, offline validation and linked/oversized inputs.
- POSIX SIGTERM handling on Linux; Windows skips that OS-specific test while running
  portable library cancellation coverage.
- Repository policy, reproducible committed-source archives, clean/tag requirements
  and rejection of linked release destinations.

The scale case demonstrates bounded correctness against a controlled local server,
not a production latency SLA or maximum throughput benchmark. Tests need no external
network service or real credential. Public endpoints, operational DNS routing and
caller-installed instrumentation remain outside the hermetic fixture evidence.
