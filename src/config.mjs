import { isIP } from 'node:net';

export const LIMITS = Object.freeze({ configBytes: 1_048_576, checks: 1_000, concurrency: 32, retries: 2, bodyBytes: 1_048_576, totalBytes: 16_777_216, deadlineMs: 120_000, timeoutMs: 30_000, assertions: 16, headerBytes: 16_384 });
export class HarborError extends Error {
  constructor(code) { super(code); this.name = 'HarborError'; this.code = code; }
}
export function fail(code) { throw new HarborError(code); }
export function isJsonType(value) { return value === 'application/json' || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(value); }
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('invalid-config');
}
export function integer(value, min, max, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid-config');
  return value;
}
function pointer(value) {
  if (typeof value !== 'string' || value.length > 256 || /[\x00-\x1f\x7f]/.test(value) || (value !== '' && !value.startsWith('/')) || /~(?![01])/.test(value)) fail('invalid-config');
  const parts = value === '' ? [] : value.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (parts.length > 16) fail('invalid-config');
  return parts;
}
export function normalizeConfig(config) {
  keys(config, ['version', 'checks']);
  if (config.version !== 1 || !Array.isArray(config.checks) || !config.checks.length || config.checks.length > LIMITS.checks) fail('invalid-config');
  const ids = new Set();
  const checks = config.checks.map(check => {
    keys(check, ['id', 'url', 'method', 'timeoutMs', 'maxBytes', 'expectedStatus', 'contentType', 'assertions']);
    if (typeof check.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(check.id) || ids.has(check.id)) fail('invalid-config');
    ids.add(check.id);
    if (typeof check.url !== 'string' || !/^https?:\/\//i.test(check.url) || check.url.length > 2048 || !check.url.isWellFormed() || /[\\\x00-\x20\x7f]/.test(check.url)) fail('invalid-url');
    let url;
    try { url = new URL(check.url); } catch { fail('invalid-url'); }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const loopback = hostname === '::1' || (isIP(hostname) === 4 && hostname.startsWith('127.'));
    if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !loopback)
      || url.username || url.password || url.search || url.hash || check.url.includes('?') || check.url.includes('#')) fail('invalid-url');
    const method = check.method === undefined ? 'GET' : check.method;
    if (!['GET', 'HEAD'].includes(method)) fail('invalid-config');
    const statuses = check.expectedStatus === undefined ? [200] : check.expectedStatus;
    if (!Array.isArray(statuses) || !statuses.length || statuses.length > 10 || statuses.some(status => !Number.isInteger(status) || status < 200 || status > 599) || new Set(statuses).size !== statuses.length) fail('invalid-config');
    const contentType = check.contentType;
    if (contentType !== undefined && (typeof contentType !== 'string' || contentType.length > 128 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType))) fail('invalid-config');
    const assertions = check.assertions === undefined ? [] : check.assertions;
    if (!Array.isArray(assertions) || assertions.length > LIMITS.assertions || (method === 'HEAD' && assertions.length)) fail('invalid-config');
    const normalizedAssertions = assertions.map(assertion => {
      keys(assertion, ['pointer', 'equals']);
      const expected = assertion.equals;
      if (!(expected === null || typeof expected === 'boolean' || (typeof expected === 'number' && Number.isFinite(expected)) || (typeof expected === 'string' && expected.length <= 256))) fail('invalid-config');
      return { parts: pointer(assertion.pointer), expected };
    });
    if (assertions.length && contentType !== undefined && !isJsonType(contentType)) fail('invalid-config');
    return { id: check.id, url, hostname, method, statuses: [...statuses], contentType, assertions: normalizedAssertions,
      timeoutMs: integer(check.timeoutMs, 50, LIMITS.timeoutMs, 2000), maxBytes: integer(check.maxBytes, 128, LIMITS.bodyBytes, 65_536) };
  });
  if (Buffer.byteLength(JSON.stringify(config)) > LIMITS.configBytes) fail('config-limit');
  return checks;
}
export function validateConfig(config) { return { version: 1, valid: true, checks: normalizeConfig(config).length }; }
export function normalizeOptions(options) {
  keys(options, ['concurrency', 'deadlineMs', 'retries', 'totalBytes', 'signal']);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('invalid-config');
  return { concurrency: integer(options.concurrency, 1, LIMITS.concurrency, 4), deadlineMs: integer(options.deadlineMs, 50, LIMITS.deadlineMs, 30_000), retries: integer(options.retries, 0, LIMITS.retries, 0), totalBytes: integer(options.totalBytes, 128, LIMITS.totalBytes, LIMITS.totalBytes), signal: options.signal };
}
