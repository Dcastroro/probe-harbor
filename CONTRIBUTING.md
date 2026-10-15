# Contributing

Use Node.js 22+. Run `npm ci --ignore-scripts`, `npm run repo:check`,
`npm run check` and `npm run demo`. No npm runtime or development dependencies
are needed. Tests use ephemeral loopback HTTP/HTTPS servers, never public services.

Preserve fixed-code diagnostics, metadata-only reports and complete per-ID result
accounting. Validate the full request set before networking. Keep DNS, connection,
retry, body, header and deadline limits synchronized with documentation. Do not
add automatic credentials, custom request headers, redirects, compressed assertion
body expansion, command execution or persistent monitoring as incidental changes.

Use generated in-memory TLS material and fictional payloads. Never commit keys or
real endpoint configuration. Cover actual concurrency, cancellation and transport
failure behavior rather than duplicating implementation. Avoid timing assertions
that depend on scheduler precision. Linux exercises POSIX signal delivery;
Windows exercises the library's portable cancellation path.

See [RELEASING.md](RELEASING.md) for clean, tag-based source publication.
