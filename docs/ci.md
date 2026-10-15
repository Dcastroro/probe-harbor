# CI readiness gate

Vendor a reviewed Probe Harbor source release into `tools/probe-harbor` in the
application repository. Start your services using the application's existing
pipeline, then run this step before integration tests or release preparation:

```yaml
- name: Verify service readiness
  timeout-minutes: 3
  run: >-
    node tools/probe-harbor/bin/probe-harbor.mjs run
    --config ci/probes.json --format json
    --concurrency 4 --deadline-ms 30000 --retries 1
```

`ci/probes.json` belongs to the application and points only to authorized,
credential-free health endpoints. A nonzero exit blocks the following workflow
steps. Do not add `continue-on-error`, convert an input error into a healthy
result or provide service/deployment tokens to the checker.

Use a pinned Node setup action in the surrounding workflow, for example:

```yaml
- uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1
  with:
    node-version: 24
    package-manager-cache: false
```

No npm package installation is needed for the vendored tool itself. Your
application still controls its own installation/startup. HEAD checks are useful
for status-only endpoints. GET assertions can verify explicit readiness flags,
such as `/dependencies/database` equalling `true`, without printing that body.

Task Relay can declare this CLI as a readiness task after externally managed
service startup, and make integration tests depend on it. Change Scope can
select affected applications before this gate runs. Probe Harbor starts no
application processes and manages no persistent services.

For untrusted changes, use read-only jobs without service/deployment secrets
and review changes to destination configuration. The tool is an operator-driven
network client; it is not a proxy that safely accepts arbitrary public URLs.
Do not use `pull_request_target` to run untrusted repository code.

## Self-contained verification

```sh
npm ci --ignore-scripts
npm run repo:check
npm run check
npm run demo
```

The tests and demo use ephemeral loopback servers and require no public endpoints.
TLS fixture keys are created in memory; a temporary public CA certificate is
passed only to the test child process and is not installed into the OS trust store.
Windows/Ubuntu CI checks Node.js 22/24. The CLI's POSIX SIGTERM handling test runs
on Linux; library cancellation is exercised on both platforms.
