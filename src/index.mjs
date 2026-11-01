import { setTimeout as delay } from 'node:timers/promises';
import { normalizeConfig, normalizeOptions, fail } from './config.mjs';
import { probeAttempt } from './network.mjs';
export { HarborError, LIMITS, validateConfig } from './config.mjs';

function retryable(attempt) {
  return ['dns-failed', 'request-failed', 'timeout'].includes(attempt.code)
    || (attempt.code === 'unexpected-status' && [429, 502, 503, 504].includes(attempt.statusCode));
}

/** One bounded run. Endpoint data is never copied into the returned report. */
export async function runProbes(config, options = {}) {
  // Validate the complete configuration before selection, including unused URLs.
  const allChecks = normalizeConfig(config), settings = normalizeOptions(options);
  const selected = settings.only === undefined ? undefined : new Set(settings.only);
  if (selected) {
    const known = new Set(allChecks.map(check => check.id));
    if ([...selected].some(id => !known.has(id))) fail('unknown-check');
  }
  const checks = selected ? allChecks.filter(check => selected.has(check.id)) : allChecks;
  const start = performance.now();
  const controller = new AbortController();
  let stop, bytes = 0, next = 0;
  const signal = settings.signal ? AbortSignal.any([controller.signal, settings.signal]) : controller.signal;
  const state = {
    signal,
    stopCode: () => settings.signal?.aborted ? 'cancelled' : stop,
    consume: amount => { bytes += amount; if (bytes > settings.totalBytes && !controller.signal.aborted) { stop = 'byte-budget'; controller.abort(); } },
  };
  const timer = setTimeout(() => { if (!controller.signal.aborted) { stop = 'deadline'; controller.abort(); } }, settings.deadlineMs);
  const results = new Array(checks.length);
  async function worker() {
    while (next < checks.length) {
      const index = next++, check = checks[index], attempts = [];
      if (!signal.aborted) {
        for (let retry = 0; retry <= settings.retries; retry += 1) {
          const attempt = await probeAttempt(check, state);
          attempts.push(attempt);
          if (attempt.code === 'healthy' || signal.aborted || !retryable(attempt) || retry === settings.retries) break;
          try { await delay(100 * 2 ** retry, undefined, { signal }); }
          catch { break; }
        }
      }
      const last = attempts.at(-1);
      const code = signal.aborted && last?.code !== 'healthy' ? state.stopCode() : last?.code;
      results[index] = { id: check.id, healthy: code === 'healthy', code: code ?? state.stopCode() ?? 'cancelled', attempts };
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(settings.concurrency, checks.length) }, worker)); }
  finally { clearTimeout(timer); }
  const healthy = results.filter(result => result.healthy).length;
  return { version: 1, ok: true, healthy: healthy === checks.length,
    summary: { checks: checks.length, healthy, unhealthy: checks.length - healthy, attempts: results.reduce((sum, result) => sum + result.attempts.length, 0), bytes, durationMs: Math.round((performance.now() - start) * 1000) / 1000 }, results };
}
