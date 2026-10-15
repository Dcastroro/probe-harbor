#!/usr/bin/env node
import { readFileSync, openSync, readSync, fstatSync, lstatSync, closeSync } from 'node:fs';
import { resolve, parse, join } from 'node:path';
import { runProbes, validateConfig, HarborError, LIMITS } from '../src/index.mjs';
import { fail } from '../src/config.mjs';
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const HELP = `Probe Harbor ${VERSION}
Bounded HTTP/HTTPS health checks with metadata-only reports.

  probe-harbor validate --config probes.json
  probe-harbor run --config probes.json [--format text|json]

  --concurrency N    1..32; default 4
  --deadline-ms N    50..120000; default 30000
  --retries N        0..2; default 0
  --total-bytes N    128..16777216; default 16777216
  --help            Show help
  --version         Show version

Only GET/HEAD. HTTPS, or HTTP to literal loopback addresses.
No authentication, query strings, redirects, cookies or environment-file loading.
Exit codes: 0 healthy/valid, 1 unhealthy/cancelled, 2 invalid input or tool failure.
`;
function readConfig(path) {
  let fd;
  try {
    const absolute = resolve(path); let current = parse(absolute).root;
    for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink()) fail('config-file');
    }
    fd = openSync(absolute, 'r'); const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > LIMITS.configBytes) fail('config-file');
    const buffer = Buffer.alloc(LIMITS.configBytes + 1); let size = 0, count;
    while (size < buffer.length && (count = readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += count;
    if (size > LIMITS.configBytes) fail('config-limit');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))); }
    catch { fail('invalid-json'); }
  } catch (error) { if (error instanceof HarborError) throw error; fail('config-file'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
try {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === '--help')) process.stdout.write(HELP);
  else if (args.length === 1 && args[0] === '--version') console.log(VERSION);
  else {
    const command = args.shift(); if (!['validate', 'run'].includes(command)) fail('usage');
    const values = new Map();
    for (let index = 0; index < args.length; index += 1) {
      const key = args[index], value = args[++index];
      if (!['--config', '--format', '--concurrency', '--deadline-ms', '--retries', '--total-bytes'].includes(key) || values.has(key) || !value || value.startsWith('--')) fail('usage');
      values.set(key, value);
    }
    const format = values.get('--format') ?? 'text';
    if (!['text', 'json'].includes(format)) fail('usage');
    if (command === 'validate' && [...values.keys()].some(key => !['--config', '--format'].includes(key))) fail('usage');
    const config = readConfig(values.get('--config') ?? 'probes.json');
    if (command === 'validate') console.log(JSON.stringify(validateConfig(config)));
    else {
      const options = {};
      for (const [flag, name] of [['--concurrency', 'concurrency'], ['--deadline-ms', 'deadlineMs'], ['--retries', 'retries'], ['--total-bytes', 'totalBytes']]) {
        if (values.has(flag)) { const text = values.get(flag); if (!/^\d+$/.test(text)) fail('usage'); options[name] = Number(text); }
      }
      const controller = new AbortController(), cancel = () => controller.abort();
      process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
      let report;
      try { report = await runProbes(config, { ...options, signal: controller.signal }); }
      finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
      if (format === 'json') console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`Probe Harbor: ${report.summary.healthy}/${report.summary.checks} healthy; ${report.summary.attempts} attempts; ${report.summary.bytes} body bytes.`);
        for (const result of report.results) console.log(`  ${result.id}: ${result.code} (${result.attempts.length} attempts)`);
      }
      process.exitCode = report.healthy ? 0 : 1;
    }
  }
} catch (error) {
  console.log(JSON.stringify({ version: 1, ok: false, error: { code: error instanceof HarborError ? error.code : 'internal-error' } }));
  process.exitCode = 2;
}
