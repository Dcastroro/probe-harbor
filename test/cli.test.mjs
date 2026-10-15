import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { tlsFixture } from '../fixtures/tls-material.mjs';

const cli = resolve('bin/probe-harbor.mjs');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
function child(args, cwd, env = process.env) {
  const process = spawn(globalThis.process.execPath, [cli, ...args], { cwd, env, windowsHide: true });
  let output = '', stderr = '';
  process.stdout.on('data', chunk => { output += chunk; }); process.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => process.kill('SIGKILL'), 15000);
  const done = new Promise((resolve, reject) => {
    process.on('error', reject); process.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, output, stderr }); });
  });
  return { process, done };
}
function fixture(t, url = 'http://127.0.0.1:1/') {
  const root = mkdtempSync(join(tmpdir(), 'harbor-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'probes.json'), JSON.stringify({ version: 1, checks: [{ id: 'api', url }] }));
  return root;
}
async function server(t, handler, tls) {
  const s = tls ? createHttpsServer(tls, handler) : createServer(handler);
  s.listen(0, '127.0.0.1'); await once(s, 'listening');
  t.after(async () => { s.close(); s.closeAllConnections(); await once(s, 'close'); });
  return { instance: s, url: `${tls ? 'https' : 'http'}://127.0.0.1:${s.address().port}` };
}

test('CLI validates configuration offline and exposes help/version without credentials', async t => {
  const root = fixture(t);
  const validation = await child(['validate'], root).done;
  assert.equal(validation.status, 0); assert.equal(JSON.parse(validation.output).valid, true);
  assert.equal((await child(['--version'], root).done).output.trim(), version);
  assert.match((await child(['--help'], root).done).output, /Probe Harbor/);
});
test('CLI healthy/unhealthy reports have meaningful exit codes and no response data', async t => {
  let bad = false;
  const s = await server(t, (req, res) => { res.writeHead(bad ? 503 : 200, { 'x-private': 'PRIVATE_HEADER' }); res.end('PRIVATE_BODY'); });
  const root = fixture(t, `${s.url}/PRIVATE_PATH`);
  const healthy = await child(['run', '--format', 'json'], root).done;
  assert.equal(healthy.status, 0); assert.equal(JSON.parse(healthy.output).healthy, true);
  assert.equal(healthy.output.includes('PRIVATE'), false); assert.equal(healthy.output.includes(root), false);
  bad = true;
  const unhealthy = await child(['run'], root).done;
  assert.equal(unhealthy.status, 1); assert.match(unhealthy.output, /unexpected-status/); assert.equal(unhealthy.output.includes('PRIVATE'), false);
});
test('ambient proxy credentials are not used by the checker', async t => {
  let proxyCalls = 0;
  const proxy = await server(t, (req, res) => { proxyCalls++; res.writeHead(500); res.end(); });
  const target = await server(t, (req, res) => res.end('ok'));
  const root = fixture(t, target.url);
  const proxyUrl = proxy.url.replace('://', '://fixture:PRIVATE_PROXY_VALUE@');
  const result = await child(['run', '--format', 'json'], root, { ...process.env, NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, NO_PROXY: '', no_proxy: '' }).done;
  assert.equal(result.status, 0, result.output); assert.equal(proxyCalls, 0); assert.equal(result.output.includes('PRIVATE'), false);
});
test('CLI verifies HTTPS against an ephemeral trusted certificate without embedded keys', async t => {
  const material = tlsFixture();
  const s = await server(t, (req, res) => res.end('ok'), material);
  const root = fixture(t, s.url); const ca = join(root, 'fixture-ca.crt'); writeFileSync(ca, material.cert);
  const result = await child(['run', '--format', 'json'], root, { ...process.env, NODE_EXTRA_CA_CERTS: ca }).done;
  assert.equal(result.status, 0, result.output); assert.equal(JSON.parse(result.output).healthy, true);
  assert.equal(result.output.includes('CERTIFICATE'), false); assert.equal(result.output.includes(root), false);
});
test('invalid usage, malformed JSON and missing files use fixed-code exit 2', async t => {
  const root = fixture(t);
  for (const args of [['PRIVATE_COMMAND'], ['run', '--unknown', 'PRIVATE'], ['run', '--format', 'bad'], ['run', '--retries', '-1'], ['run', '--format', 'json', '--format', 'json'], ['validate', '--concurrency', '2'], ['run', '--config', 'PRIVATE_MISSING.json']]) {
    const result = await child(args, root).done; assert.equal(result.status, 2); assert.equal(JSON.parse(result.output).ok, false); assert.equal(result.output.includes('PRIVATE'), false);
  }
  writeFileSync(join(root, 'probes.json'), 'PRIVATE_INVALID_JSON');
  const invalid = await child(['run'], root).done; assert.equal(invalid.status, 2); assert.equal(invalid.output.includes('PRIVATE'), false);
});
test('linked directories and oversized config files are rejected without raw paths', async t => {
  const root = fixture(t); mkdirSync(join(root, 'source'));
  writeFileSync(join(root, 'source', 'probes.json'), '{}');
  symlinkSync(join(root, 'source'), join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const linked = await child(['run', '--config', 'link/probes.json'], root).done;
  assert.equal(linked.status, 2); assert.equal(JSON.parse(linked.output).error.code, 'config-file');
  writeFileSync(join(root, 'probes.json'), 'x'.repeat(1_048_577));
  assert.equal((await child(['run'], root).done).status, 2);
});
test('CLI SIGTERM returns a sanitized cancellation report on POSIX', async t => {
  if (process.platform === 'win32') { t.skip('Windows process termination does not deliver POSIX SIGTERM handlers'); return; }
  let seen;
  const connected = new Promise(resolve => { seen = resolve; });
  const s = await server(t, () => { seen(); }); const root = fixture(t, s.url);
  const running = child(['run', '--format', 'json'], root);
  await connected; running.process.kill('SIGTERM');
  const result = await running.done;
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.output).results[0].code, 'cancelled');
});
