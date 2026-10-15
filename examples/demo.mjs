import { createServer } from 'node:http';
import { once } from 'node:events';
import { runProbes } from '../src/index.mjs';

// Self-contained demo: only an ephemeral loopback server, no remote services.
let calls = 0;
const server = createServer((req, res) => {
  if (req.url === '/warming' && calls++ === 0) { res.writeHead(503); res.end(); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ready', internalDetail: 'fictional-demo-value' }));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const report = await runProbes({ version: 1, checks: [
    { id: 'api-ready', url: `${origin}/ready`, assertions: [{ pointer: '/status', equals: 'ready' }] },
    { id: 'worker-ready', url: `${origin}/warming` },
    { id: 'web-alive', url: `${origin}/health`, method: 'HEAD' },
  ] }, { concurrency: 2, retries: 1, deadlineMs: 5000 });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.healthy ? 0 : 1;
} finally { server.close(); server.closeAllConnections(); await once(server, 'close'); }
