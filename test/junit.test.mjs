import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { junitReport } from '../src/junit.mjs';

const cli = fileURLToPath(new URL('../bin/probe-harbor.mjs', import.meta.url));
async function server(t, handler) {
  const s = createServer(handler);
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  t.after(async () => {
    s.close();
    s.closeAllConnections();
    await once(s, 'close');
  });
  return `http://127.0.0.1:${s.address().port}`;
}
function fixture(t, checks) {
  const root = mkdtempSync(join(tmpdir(), 'harbor-junit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, 'probes.json'),
    JSON.stringify({ version: 1, checks }),
  );
  return root;
}
async function run(root, extra = [], command = 'run') {
  const child = spawn(
    process.execPath,
    [cli, command, '--format', 'junit', ...extra],
    { cwd: root, windowsHide: true },
  );
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (x) => {
    stdout += x;
  });
  child.stderr.on('data', (x) => {
    stderr += x;
  });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const [status, signal] = await once(child, 'close');
    return { status, signal, stdout, stderr };
  } finally {
    clearTimeout(watchdog);
  }
}
function cases(xml) {
  return [...xml.matchAll(/<testcase\b[^>]* name="([^"]+)"[^>]*>/g)].map(
    (x) => x[1],
  );
}

test('JUnit output preserves input order, final failures and metadata privacy', async (t) => {
  const url = await server(t, (req, res) => {
    res.writeHead(req.url.includes('bad') ? 503 : 200, {
      'x-private': 'PRIVATE_HEADER',
    });
    res.end('PRIVATE_BODY');
  });
  const root = fixture(t, [
    { id: 'ready', url: `${url}/PRIVATE_PATH` },
    { id: 'unready', url: `${url}/bad/PRIVATE_PATH` },
  ]);
  const r = await run(root);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /^<\?xml version="1.0" encoding="UTF-8"\?>\n/);
  assert.match(
    r.stdout,
    /<testsuite name="Probe Harbor" tests="2" failures="1" errors="0" time="\d+\.\d{6}">/,
  );
  assert.deepEqual(cases(r.stdout), ['ready', 'unready']);
  assert.equal((r.stdout.match(/<failure /g) ?? []).length, 1);
  assert.match(
    r.stdout,
    /<failure type="unexpected-status" message="unexpected-status"\/>/,
  );
  for (const privateValue of ['PRIVATE_', url, root])
    assert.equal(r.stdout.includes(privateValue), false);
});

test('a successful retry produces one successful JUnit testcase', async (t) => {
  let hits = 0;
  const url = await server(t, (_req, res) => {
    res.writeHead(++hits === 1 ? 503 : 200);
    res.end();
  });
  const r = await run(fixture(t, [{ id: 'retried', url }]), ['--retries', '1']);
  assert.equal(r.status, 0);
  assert.equal(hits, 2);
  assert.deepEqual(cases(r.stdout), ['retried']);
  assert.match(r.stdout, /tests="1" failures="0" errors="0"/);
  assert.equal(r.stdout.includes('<failure'), false);
});

test('deadline results include queued checks as failures rather than omitted or skipped tests', async (t) => {
  const url = await server(t, () => {});
  const r = await run(
    fixture(
      t,
      ['first', 'second', 'third'].map((id) => ({ id, url, timeoutMs: 1000 })),
    ),
    ['--concurrency', '1', '--deadline-ms', '50'],
  );
  assert.equal(r.status, 1);
  assert.deepEqual(cases(r.stdout), ['first', 'second', 'third']);
  assert.match(r.stdout, /tests="3" failures="3" errors="0"/);
  assert.equal((r.stdout.match(/<failure type="deadline"/g) ?? []).length, 3);
  assert.equal(r.stdout.includes('<skipped'), false);
});

test('input errors keep exit 2 and fixed JSON diagnostics in JUnit mode', async (t) => {
  const root = fixture(t, [
    { id: 'api', url: 'https://unit.invalid/?PRIVATE_VALUE' },
  ]);
  const r = await run(root);
  assert.equal(r.status, 2);
  assert.deepEqual(JSON.parse(r.stdout), {
    version: 1,
    ok: false,
    error: { code: 'invalid-url' },
  });
  assert.equal(r.stderr, '');
});

test('JUnit is a run report and is refused for offline validate', async (t) => {
  const root = fixture(t, [{ id: 'api', url: 'https://unit.invalid/' }]);
  const r = await run(root, [], 'validate');
  assert.equal(r.status, 2);
  assert.deepEqual(JSON.parse(r.stdout), {
    version: 1,
    ok: false,
    error: { code: 'usage' },
  });
});

test('JUnit escapes XML attributes, uses seconds, and omits unselected report fields', () => {
  const xml = junitReport({
    summary: {
      checks: 1,
      unhealthy: 1,
      durationMs: 1250,
      private: 'PRIVATE_SUMMARY',
    },
    results: [
      {
        id: 'a&<>"\'',
        healthy: false,
        code: 'request-failed',
        url: 'PRIVATE_URL',
        attempts: [
          { durationMs: 200, body: 'PRIVATE_BODY' },
          { durationMs: 300 },
        ],
      },
    ],
  });
  assert.equal(
    xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<testsuite name="Probe Harbor" tests="1" failures="1" errors="0" time="1.250000">\n' +
      '  <testcase classname="probe-harbor" name="a&amp;&lt;&gt;&quot;&apos;" time="0.500000">\n' +
      '    <failure type="request-failed" message="request-failed"/>\n' +
      '  </testcase>\n</testsuite>\n',
  );
});
