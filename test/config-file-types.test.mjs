import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../bin/probe-harbor.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'harbor-file-types-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
}
function rejected(result, code) {
  assert.equal(
    result.error,
    undefined,
    'CLI must finish without the parent watchdog killing it',
  );
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    ok: false,
    error: { code },
  });
}

for (const command of ['validate', 'run']) {
  test(
    `${command} rejects a FIFO with no writer instead of blocking`,
    {
      skip:
        process.platform === 'win32'
          ? 'POSIX FIFO fixture requires mkfifo'
          : false,
    },
    (t) => {
      const root = fixture(t);
      const name = command === 'run' ? 'probes.json' : 'PRIVATE_PIPE.json';
      const created = spawnSync('mkfifo', [join(root, name)], {
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(created.error, undefined);
      assert.equal(created.status, 0);
      rejected(
        run(root, command === 'run' ? ['run'] : ['validate', '--config', name]),
        'config-file',
      );
    },
  );
}

test('ordinary JSON files still validate offline', (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, 'probes.json'),
    JSON.stringify({
      version: 1,
      checks: [{ id: 'api', url: 'https://example.invalid/' }],
    }),
  );
  const result = run(root, ['validate']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    valid: true,
    checks: 1,
  });
});

test('a directory named as config has the same sanitized file diagnostic', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'PRIVATE_DIRECTORY.json'));
  rejected(
    run(root, ['validate', '--config', 'PRIVATE_DIRECTORY.json']),
    'config-file',
  );
});

test('empty regular files still report invalid JSON rather than a file-type error', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'probes.json'), '');
  rejected(run(root, ['validate']), 'invalid-json');
});
