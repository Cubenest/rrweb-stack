// Loopback static + API server for the @tracelane/playwright live demo.
//
// Serving over http://127.0.0.1:<port> (not file://) keeps the captured origin
// a redactable loopback authority — no absolute machine path ever enters the
// rrweb snapshot or the report metadata. The API routes return REAL HTTP
// failures (a 404 and a 500) so they traverse the full network stack and are
// captured by tracelane's CDP path (Network.responseReceived, status >= 400) —
// deterministically, with no Playwright route interception in the mix.
//
// Prints `DEMO_PORT=<port>` on a known stdout line so the generator can read
// the ephemeral port it bound to.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function sendHtml(res, name) {
  const file = join(here, normalize(name).replace(/^(\.\.[/\\])+/, ''));
  if (file.startsWith(here) && existsSync(file) && file.endsWith('.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(file));
    return true;
  }
  return false;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const method = req.method || 'GET';
  const path = (req.url || '/').split('?')[0];

  // API routes — REAL HTTP failures, captured by CDP as failed responses.
  if (method === 'GET' && path.startsWith('/api/recommendations/')) {
    sendJson(res, 404, { error: 'no recommendations for this SKU' });
    return;
  }
  if (method === 'POST' && path === '/api/checkout') {
    // Drain the request body so the client's POST completes cleanly.
    req.on('data', () => {});
    req.on('end', () => {
      sendJson(res, 500, { error: 'payment_gateway_timeout', requestId: 'demo-7f3a' });
    });
    return;
  }

  // Static pages.
  const name = path === '/' ? '/products.html' : path;
  if (method === 'GET' && sendHtml(res, name)) return;

  sendJson(res, 404, { error: 'not found' });
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  // Known line the generator greps for.
  console.log(`DEMO_PORT=${port}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
