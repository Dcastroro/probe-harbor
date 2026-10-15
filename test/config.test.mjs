import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, runProbes, HarborError, LIMITS } from '../src/index.mjs';
const config = (extra = {}) => ({ version: 1, checks: [{ id: 'api', url: 'http://127.0.0.1/health', ...extra }] });
const invalid = (value, code = 'invalid-config') => assert.throws(() => validateConfig(value), error => error instanceof HarborError && error.code === code && error.message === code);

test('validates HTTPS and literal-loopback HTTP without a request', () => {
  for (const url of ['https://example.invalid/ready', 'http://127.0.0.1:1234/health', 'http://[::1]:3000/health']) assert.equal(validateConfig(config({ url })).valid, true);
});
test('rejects credentials, queries, fragments, insecure remote HTTP and malformed URLs', () => {
  for (const url of ['http://example.invalid/health', 'http://localhost/', 'https://user:PRIVATE@unit.invalid/', 'https://unit.invalid/?PRIVATE=value', 'https://unit.invalid/?', 'https://unit.invalid/#', 'file:///PRIVATE', 'ftp://unit.invalid/', 'https:unit.invalid', 'https://unit.invalid\\PRIVATE', 'https://unit.invalid/\nPRIVATE']) invalid(config({ url }), 'invalid-url');
});
test('methods, statuses, unknown fields, duplicate IDs and assertion types fail closed', () => {
  for (const extra of [{ method: 'POST' }, { headers: { authorization: 'PRIVATE' } }, { expectedStatus: [] }, { expectedStatus: [101] }, { expectedStatus: [200,200] }, { assertions: null }, { assertions: [{ pointer: '/x', equals: {} }] }, { assertions: [{ pointer: '/x', equals: NaN }] }, { assertions: [{ pointer: '/~2', equals: 'x' }] }, { method: 'HEAD', assertions: [{ pointer: '', equals: 'x' }] }, { contentType: 'text/plain', assertions: [{ pointer: '', equals: 'x' }] }]) invalid(config(extra));
  const duplicate = config(); duplicate.checks.push(duplicate.checks[0]); invalid(duplicate);
  invalid({ version: 2, checks: [] }); invalid({ version: 1, checks: [] });
  invalid(config({ contentType: 'text/custom+json', assertions: [{ pointer: '', equals: true }] }));
});
test('enforces check, body, timeout, assertion and pointer budgets', () => {
  invalid({ version: 1, checks: Array(LIMITS.checks + 1).fill(config().checks[0]) });
  for (const extra of [{ timeoutMs: 49 }, { maxBytes: LIMITS.bodyBytes + 1 }, { assertions: Array(17).fill({ pointer: '', equals: true }) }, { assertions: [{ pointer: '/x'.repeat(17), equals: true }] }]) invalid(config(extra));
});
test('runtime option errors are fixed-code failures before any network work', async () => {
  for (const options of [{ concurrency: 0 }, { concurrency: 33 }, { deadlineMs: Infinity }, { retries: 3 }, { totalBytes: 1 }, { signal: 'PRIVATE' }, { credentials: 'PRIVATE' }]) await assert.rejects(runProbes(config(), options), error => error.code === 'invalid-config' && !error.message.includes('PRIVATE'));
});
test('invalid input errors do not echo endpoint secrets or config values', () => {
  try { validateConfig(config({ url: 'https://PRIVATE_HOST/?PRIVATE_QUERY=value' })); assert.fail(); }
  catch (error) { assert.equal(JSON.stringify(error).includes('PRIVATE'), false); assert.equal(error.message, 'invalid-url'); }
});
