import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { once } from 'node:events';
import { Resolver } from 'node:dns/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { runProbes } from '../src/index.mjs';
import { addressesFor } from '../src/network.mjs';
import { tlsFixture } from '../fixtures/tls-material.mjs';

async function server(t, handler) {
  const instance = createServer(handler);
  instance.listen(0, '127.0.0.1'); await once(instance, 'listening');
  t.after(async () => { instance.close(); instance.closeAllConnections(); await once(instance, 'close'); });
  return { instance, url: `http://127.0.0.1:${instance.address().port}` };
}
const config = (...checks) => ({ version: 1, checks });
const check = (url, extra = {}) => ({ id: 'api', url, ...extra });

test('status, MIME and JSON pointer assertions pass with metadata-only output', async t => {
  const s = await server(t, (req, res) => { res.writeHead(200, { 'content-type': 'application/health+json; charset=utf-8', 'x-private': 'PRIVATE_HEADER' }); res.end('{"status":"ready","a/b":{"~value":[true]},"private":"PRIVATE_BODY"}'); });
  const report = await runProbes(config(check(`${s.url}/PRIVATE_PATH`, { assertions: [{ pointer: '/status', equals: 'ready' }, { pointer: '/a~1b/~0value/0', equals: true }] })));
  assert.equal(report.healthy, true); assert.equal(report.summary.attempts, 1);
  const text = JSON.stringify(report); assert.equal(text.includes('PRIVATE'), false); assert.equal(text.includes(s.url), false); assert.equal(text.includes('ready'), false);
});
test('HEAD probes accept configured statuses without retaining a body', async t => {
  const s = await server(t, (req, res) => { assert.equal(req.method, 'HEAD'); res.writeHead(204); res.end(); });
  const report = await runProbes(config(check(s.url, { method: 'HEAD', expectedStatus: [200,204] })));
  assert.equal(report.healthy, true); assert.equal(report.summary.bytes, 0);
});
test('JSON assertions never follow prototype properties or array metadata', async t => {
  const s = await server(t, (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[true]'); });
  for (const pointer of ['/length', '/__proto__', '/01']) {
    const report = await runProbes(config(check(s.url, { assertions: [{ pointer, equals: 1 }] })));
    assert.equal(report.results[0].code, 'assertion-failed');
  }
});
test('malformed JSON, encoding, media type and assertion mismatches use fixed codes', async t => {
  const cases = [
    ['application/json', '', 'PRIVATE_MALFORMED', 'invalid-json'],
    ['text/html', '', '{"x":true}', 'unexpected-content-type'],
    ['application/json', 'gzip', 'PRIVATE_COMPRESSED', 'unsupported-encoding'],
    ['application/json', '', '{"x":"PRIVATE_VALUE"}', 'assertion-failed'],
  ];
  for (const [type, encoding, body, code] of cases) {
    const s = await server(t, (req, res) => { res.writeHead(200, { 'content-type': type, ...(encoding ? { 'content-encoding': encoding } : {}) }); res.end(body); });
    const report = await runProbes(config(check(s.url, { assertions: [{ pointer: '/x', equals: true }] })));
    assert.equal(report.results[0].code, code); assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  }
});
test('redirects are not followed, including when the redirect status is expected', async t => {
  let followed = 0;
  const target = await server(t, (req, res) => { followed++; res.end(); });
  const source = await server(t, (req, res) => { res.writeHead(302, { location: `${target.url}/PRIVATE_REDIRECT` }); res.end(); });
  assert.equal((await runProbes(config(check(source.url)))).healthy, false);
  assert.equal((await runProbes(config(check(source.url, { expectedStatus: [302] })))).healthy, true);
  assert.equal(followed, 0);
});
test('ambient credentials and response cookies never become request headers', async t => {
  const previous = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = 'PRIVATE_AMBIENT_VALUE';
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  let hits = 0;
  const s = await server(t, (req, res) => {
    hits++; assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.cookie, undefined);
    res.writeHead(200, { 'set-cookie': 'PRIVATE_COOKIE=fictional' }); res.end();
  });
  assert.equal((await runProbes(config(check(s.url), check(s.url, { id: 'second' })))).healthy, true);
  assert.equal(hits, 2);
});
test('transient statuses retry within a bounded policy and preserve evidence', async t => {
  let calls = 0;
  const s = await server(t, (req, res) => { res.writeHead(calls++ === 0 ? 503 : 200); res.end(); });
  const report = await runProbes(config(check(s.url)), { retries: 1 });
  assert.equal(report.healthy, true); assert.equal(calls, 2);
  assert.deepEqual(report.results[0].attempts.map(a => a.code), ['unexpected-status','healthy']);
});
test('retry exhaustion is bounded and a deadline interrupts backoff', async t => {
  let calls = 0;
  const s = await server(t, (req, res) => { calls++; res.writeHead(503); res.end(); });
  const exhausted = await runProbes(config(check(s.url)), { retries: 2 });
  assert.equal(exhausted.healthy, false); assert.equal(calls, 3); assert.equal(exhausted.summary.attempts, 3);
  const deadline = await runProbes(config(check(s.url)), { retries: 2, deadlineMs: 60 });
  assert.equal(deadline.results[0].code, 'deadline'); assert.equal(deadline.summary.attempts, 1);
});
test('assertion failures and ordinary non-transient HTTP errors do not retry', async t => {
  let calls = 0;
  const s = await server(t, (req, res) => { calls++; res.writeHead(401); res.end('PRIVATE_ERROR'); });
  const report = await runProbes(config(check(s.url)), { retries: 2 });
  assert.equal(report.healthy, false); assert.equal(calls, 1); assert.equal(report.summary.attempts, 1);
});
test('timeouts and global deadlines close requests and account for queued checks', async t => {
  const s = await server(t, (req, res) => { /* no response until the client cancels */ });
  const timeout = await runProbes(config(check(s.url, { timeoutMs: 80 })));
  assert.equal(timeout.results[0].code, 'timeout');
  const many = config(...Array.from({ length: 12 }, (_, i) => check(s.url, { id: `p${i}`, timeoutMs: 1000 })));
  const report = await runProbes(many, { concurrency: 2, deadlineMs: 100 });
  assert.equal(report.results.length, 12); assert.ok(report.results.every(result => result.code === 'deadline'));
  assert.equal(report.summary.attempts, 2);
});
test('cancellation before a run sends no requests and never echoes abort reasons', async t => {
  let calls = 0; const s = await server(t, (req, res) => { calls++; res.end(); });
  const controller = new AbortController(); controller.abort('PRIVATE_ABORT_REASON');
  const report = await runProbes(config(check(s.url)), { signal: controller.signal });
  assert.equal(calls, 0); assert.equal(report.results[0].code, 'cancelled'); assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
});
test('in-flight cancellation stops the run and returns every configured ID', async t => {
  const s = await server(t, (req, res) => {}); const controller = new AbortController();
  const running = runProbes(config(check(s.url), check(s.url, { id: 'queued' })), { concurrency: 1, signal: controller.signal });
  setTimeout(() => controller.abort(new Error('PRIVATE_REASON')), 50);
  const report = await running; assert.equal(report.results.length, 2); assert.ok(report.results.every(result => result.code === 'cancelled'));
});
test('body and aggregate byte budgets terminate oversized streams', async t => {
  const s = await server(t, (req, res) => { res.write('x'.repeat(4096)); /* deliberately never ends */ });
  const single = await runProbes(config(check(s.url, { maxBytes: 128 })));
  assert.equal(single.results[0].code, 'body-limit');
  const report = await runProbes(config(check(s.url), check(s.url, { id: 'queued' })), { concurrency: 1, totalBytes: 128 });
  assert.ok(report.results.every(result => result.code === 'byte-budget')); assert.equal(report.summary.attempts, 1);
});
test('protocol upgrades are refused and their socket is closed', async t => {
  const s = await server(t, (req, res) => { res.writeHead(101, { connection: 'Upgrade', upgrade: 'fixture' }); res.end(); });
  const report = await runProbes(config(check(s.url)));
  assert.equal(report.results[0].code, 'unsupported-upgrade');
});
test('oversized response headers and truncated bodies are contained as request failures', async t => {
  const headers = await server(t, (req, res) => { res.writeHead(200, { 'x-private': 'x'.repeat(20000) }); res.end(); });
  assert.equal((await runProbes(config(check(headers.url)))).results[0].code, 'request-failed');
  const truncated = await server(t, (req, res) => { res.writeHead(200, { 'content-length': '100' }); res.end('tiny'); });
  const report = await runProbes(config(check(truncated.url, { timeoutMs: 300 })));
  assert.ok(['request-failed', 'timeout'].includes(report.results[0].code));
});
test('invalid later checks prevent the entire run from sending requests', async t => {
  let calls = 0; const s = await server(t, (req, res) => { calls++; res.end(); });
  await assert.rejects(runProbes(config(check(s.url), check('https://PRIVATE/?secret=x', { id: 'bad' }))), error => error.code === 'invalid-url');
  assert.equal(calls, 0);
});
test('TLS certificates remain verified even when an insecure ambient override is present', async t => {
  const s = createHttpsServer(tlsFixture(), (req, res) => res.end());
  s.listen(0, '127.0.0.1'); await once(s, 'listening');
  t.after(async () => { s.close(); s.closeAllConnections(); await once(s, 'close'); });
  const old = process.env.NODE_TLS_REJECT_UNAUTHORIZED; process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try { assert.equal((await runProbes(config(check(`https://127.0.0.1:${s.address().port}`)))).results[0].code, 'request-failed'); }
  finally { if (old === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = old; }
});
test('DNS failure is sanitized and a cancelled resolver cannot hold the run open', async t => {
  t.mock.method(Resolver.prototype, 'resolve4', async () => { throw new Error('PRIVATE_DNS'); });
  t.mock.method(Resolver.prototype, 'resolve6', async () => { throw new Error('PRIVATE_DNS'); });
  const report = await runProbes(config(check('https://private.invalid/')));
  assert.equal(report.results[0].code, 'dns-failed'); assert.equal(JSON.stringify(report).includes('private.invalid'), false);
  t.mock.restoreAll();
  t.mock.method(Resolver.prototype, 'resolve4', () => new Promise(() => {}));
  t.mock.method(Resolver.prototype, 'resolve6', () => new Promise(() => {}));
  let cancelled = 0; t.mock.method(Resolver.prototype, 'cancel', () => { cancelled++; });
  const controller = new AbortController(); const pending = addressesFor('private.invalid', controller.signal, 1000);
  controller.abort(); await assert.rejects(pending); assert.ok(cancelled > 0);
});
test('DNS pins a bounded set from both address families when available', async t => {
  t.mock.method(Resolver.prototype, 'resolve4', async () => Array(30).fill('127.0.0.1'));
  t.mock.method(Resolver.prototype, 'resolve6', async () => ['::1']);
  const addresses = await addressesFor('fixture.invalid', new AbortController().signal, 1000);
  assert.equal(addresses.length, 17); assert.equal(addresses[0].family, 4); assert.equal(addresses.at(-1).family, 6);
});
test('1,000 real probes respect concurrency, retain order and leave no work unaccounted', { timeout: 30000 }, async t => {
  let active = 0, peak = 0, calls = 0;
  const s = await server(t, async (req, res) => { active++; calls++; peak = Math.max(peak, active); await delay(2); active--; res.end(); });
  const checks = Array.from({ length: 1000 }, (_, i) => check(s.url, { id: `p${i}`, timeoutMs: 5000 }));
  const report = await runProbes(config(...checks), { concurrency: 8, deadlineMs: 25000 });
  assert.equal(report.healthy, true); assert.equal(calls, 1000); assert.ok(peak <= 8); assert.ok(peak > 1);
  assert.deepEqual(report.results.map(result => result.id), checks.map(c => c.id)); assert.equal(report.summary.attempts, 1000);
});
