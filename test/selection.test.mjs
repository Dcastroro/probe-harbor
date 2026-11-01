import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runProbes, HarborError } from '../src/index.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const cli = fileURLToPath(new URL('../bin/probe-harbor.mjs', import.meta.url));
async function fixture(t) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(req.url === '/bad' ? 503 : 200);
    res.end('PRIVATE_BODY');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    server.closeAllConnections();
    await once(server, 'close');
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const config = {
    version: 1,
    checks: [
      { id: 'bad', url: url + '/bad' },
      { id: 'api', url: url + '/api' },
      { id: 'web', url: url + '/web' },
    ],
  };
  return { hits, config };
}
const rejected = (promise, code = 'invalid-config') =>
  assert.rejects(
    promise,
    (e) => e instanceof HarborError && e.code === code && e.message === code,
  );
async function command(t, config, args) {
  const root = mkdtempSync(join(tmpdir(), 'harbor-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'probes.json'), JSON.stringify(config));
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: root,
    windowsHide: true,
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (x) => {
    stdout += x;
  });
  child.stderr.on('data', (x) => {
    stderr += x;
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const [status] = await once(child, 'close');
    return { status, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

test('only selected checks make requests, in configuration report order', async (t) => {
  const { config, hits } = await fixture(t);
  const report = await runProbes(config, {
    only: ['web', 'api'],
    concurrency: 1,
  });
  assert.equal(report.healthy, true);
  assert.deepEqual(hits, ['/api', '/web']);
  assert.deepEqual(
    report.results.map((x) => x.id),
    ['api', 'web'],
  );
  assert.equal(report.summary.checks, 2);
  assert.equal(report.summary.attempts, 2);
  assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
});

test('omitting only retains the full run and its unhealthy exit semantics', async (t) => {
  const { config, hits } = await fixture(t);
  const report = await runProbes(config, { concurrency: 1 });
  assert.equal(report.healthy, false);
  assert.equal(report.summary.checks, 3);
  assert.deepEqual(hits, ['/bad', '/api', '/web']);
});

test('a selected failure retains retries and does not run other checks', async (t) => {
  const { config, hits } = await fixture(t);
  const report = await runProbes(config, { only: ['bad'], retries: 1 });
  assert.equal(report.healthy, false);
  assert.equal(report.summary.checks, 1);
  assert.equal(report.summary.attempts, 2);
  assert.deepEqual(
    report.results.map((x) => x.id),
    ['bad'],
  );
  assert.deepEqual(hits, ['/bad', '/bad']);
});

test('unknown IDs fail before any request and do not echo the supplied ID', async (t) => {
  const { config, hits } = await fixture(t);
  await rejected(
    runProbes(config, { only: ['private-missing'] }),
    'unknown-check',
  );
  assert.deepEqual(hits, []);
});

test('invalid unselected configuration still blocks the whole run', async (t) => {
  const { config, hits } = await fixture(t);
  config.checks[0].url = 'https://unit.invalid/?PRIVATE_QUERY';
  await rejected(runProbes(config, { only: ['api'] }), 'invalid-url');
  assert.deepEqual(hits, []);
});

test('selection arrays reject empty, duplicate, malformed, sparse and oversized inputs', async (t) => {
  const { config, hits } = await fixture(t);
  for (const only of [
    [],
    ['api', 'api'],
    ['PRIVATE_INVALID'],
    'api',
    null,
    new Array(1),
    Array(1001).fill('api'),
  ])
    await rejected(runProbes(config, { only }));
  const inherited = new Array(1),
    prototype = Object.create(Array.prototype);
  prototype[0] = 'api';
  Object.setPrototypeOf(inherited, prototype);
  await rejected(runProbes(config, { only: inherited }));
  assert.deepEqual(hits, []);
});

test('cancellation accounts for every selected ID without sending requests', async (t) => {
  const { config, hits } = await fixture(t),
    controller = new AbortController();
  controller.abort();
  const report = await runProbes(config, {
    only: ['web', 'api'],
    signal: controller.signal,
  });
  assert.deepEqual(
    report.results.map((x) => [x.id, x.code]),
    [
      ['api', 'cancelled'],
      ['web', 'cancelled'],
    ],
  );
  assert.equal(report.summary.checks, 2);
  assert.equal(report.summary.attempts, 0);
  assert.deepEqual(hits, []);
});

test('CLI comma-separated selection returns a normal metadata report', async (t) => {
  const { config, hits } = await fixture(t);
  const r = await command(t, config, [
    'run',
    '--only',
    'web,api',
    '--format',
    'json',
    '--concurrency',
    '1',
  ]);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.deepEqual(
    JSON.parse(r.stdout).results.map((x) => x.id),
    ['api', 'web'],
  );
  assert.deepEqual(hits, ['/api', '/web']);
});

test('CLI selection errors remain fixed JSON diagnostics and never start requests', async (t) => {
  const { config, hits } = await fixture(t);
  for (const [value, code] of [
    ['private-missing', 'unknown-check'],
    ['api,', 'invalid-config'],
    ['api,api', 'invalid-config'],
  ]) {
    const r = await command(t, config, ['run', '--only', value]);
    assert.equal(r.status, 2);
    assert.deepEqual(JSON.parse(r.stdout), {
      version: 1,
      ok: false,
      error: { code },
    });
  }
  const validation = await command(t, config, ['validate', '--only', 'api']);
  assert.equal(validation.status, 2);
  assert.equal(JSON.parse(validation.stdout).error.code, 'usage');
  assert.deepEqual(hits, []);
});
