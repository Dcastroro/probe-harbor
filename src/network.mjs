import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { LIMITS, isJsonType } from './config.mjs';

export async function addressesFor(hostname, signal, timeoutMs) {
  if (signal.aborted) throw new Error('aborted');
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) }];
  const resolver = new Resolver({ timeout: Math.min(timeoutMs, 5000), tries: 1 });
  let onAbort;
  const cancelled = new Promise((_, reject) => { onAbort = () => { resolver.cancel(); reject(new Error('aborted')); }; signal.addEventListener('abort', onAbort, { once: true }); });
  let graceTimer;
  try {
    const found = [];
    const collect = (values, family) => {
      const valid = values.filter(address => isIP(address) === family).slice(0, 16).map(address => ({ address, family }));
      if (!valid.length) throw new Error('dns');
      found.push(...valid); return valid;
    };
    const queries = [resolver.resolve4(hostname).then(values => collect(values, 4)), resolver.resolve6(hostname).then(values => collect(values, 6))];
    await Promise.race([Promise.any(queries), cancelled]);
    // Briefly collect the other family, then pin addresses without waiting on a stalled DNS query.
    await Promise.race([Promise.allSettled(queries), cancelled, new Promise(resolve => { graceTimer = setTimeout(resolve, 25); })]);
    if (signal.aborted) throw new Error('aborted');
    return found.sort((a, b) => a.family - b.family);
  } finally { clearTimeout(graceTimer); signal.removeEventListener('abort', onAbort); resolver.cancel(); }
}

function assertionMatches(value, assertion) {
  for (const part of assertion.parts) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return false;
    if (Array.isArray(value) && (!/^(?:0|[1-9]\d*)$/.test(part) || !Number.isSafeInteger(Number(part)) || Number(part) >= value.length)) return false;
    value = value[part];
  }
  return value === assertion.expected;
}

export async function probeAttempt(check, state) {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), check.timeoutMs);
  const signal = AbortSignal.any([state.signal, controller.signal]);
  const aborted = () => state.stopCode() ?? 'timeout';
  const duration = () => Math.round((performance.now() - start) * 1000) / 1000;
  try {
    let addresses;
    try { addresses = await addressesFor(check.hostname, signal, check.timeoutMs); }
    catch { return { code: signal.aborted ? aborted() : 'dns-failed', durationMs: duration(), bytes: 0 }; }
    if (signal.aborted) return { code: aborted(), durationMs: duration(), bytes: 0 };
    return await new Promise(resolve => {
      let settled = false, bytes = 0, statusCode;
      const chunks = [];
      let req;
      const finish = code => {
        if (settled) return;
        settled = true;
        resolve({ code, ...(statusCode !== undefined ? { statusCode } : {}), durationMs: duration(), bytes });
        req?.destroy();
      };
      const lookup = (_hostname, options, callback) => {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      };
      try {
        req = (check.url.protocol === 'https:' ? httpsRequest : httpRequest)(check.url, {
          method: check.method, agent: false, signal, lookup,
          rejectUnauthorized: true, maxHeaderSize: LIMITS.headerBytes, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 100,
          headers: { accept: 'application/json, text/plain, */*', 'accept-encoding': 'identity', 'user-agent': 'probe-harbor' },
        }, res => {
          statusCode = res.statusCode;
          // Drain only a bounded body; do not keep headers or response objects in reports.
          res.on('data', chunk => {
            if (settled) return;
            bytes += chunk.length;
            state.consume(chunk.length);
            if (state.signal.aborted) { finish(aborted()); return; }
            if (bytes > check.maxBytes) { finish('body-limit'); return; }
            if (check.assertions.length) chunks.push(chunk);
          });
          res.on('error', () => finish(signal.aborted ? aborted() : 'request-failed'));
          res.on('end', () => {
            if (settled) return;
            if (!check.statuses.includes(statusCode)) { finish('unexpected-status'); return; }
            const type = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'].split(';')[0].trim().toLowerCase() : '';
            if ((check.contentType && type !== check.contentType) || (check.assertions.length && !isJsonType(type))) { finish('unexpected-content-type'); return; }
            if (check.assertions.length) {
              if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { finish('unsupported-encoding'); return; }
              let value;
              try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
              catch { finish('invalid-json'); return; }
              if (check.assertions.some(assertion => !assertionMatches(value, assertion))) { finish('assertion-failed'); return; }
            }
            finish('healthy');
          });
        });
        req.on('error', () => finish(signal.aborted ? aborted() : 'request-failed'));
        req.on('upgrade', (res, socket) => { statusCode = res.statusCode; socket.destroy(); finish('unsupported-upgrade'); });
        req.end();
      } catch { finish(signal.aborted ? aborted() : 'request-failed'); }
    });
  } finally { clearTimeout(timer); }
}
