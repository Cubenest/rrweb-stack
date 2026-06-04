// Live demo report generator for @tracelane/playwright.
//
// Produces ONE real, regeneratable report from a deterministic two-page checkout
// failure, redacts every machine-specific string from BOTH the plaintext HTML
// and the gzipped event blob, runs a dual-surface leak-guard, and writes the
// result to apps/tracelane-docs/public/demo/playwright-checkout-failure.html.
//
// Why the redaction is not a simple string-replace: the report embeds the rrweb
// events as `const EVENTS_GZ_B64 = "<gzip+base64>"`. The captured origin
// (http://127.0.0.1:<port>) and any filesystem paths live INSIDE that gzipped
// blob (Meta.data.href, the FullSnapshot DOM tree, network/console plugin
// payloads) as well as in the plaintext consts (title, META, CONSOLE, NETWORK,
// MARKDOWN) and the error <pre>. A regex over the outer HTML can never reach the
// gzipped copy. So we decode the blob, redact the decoded JSON, re-encode it
// (the in-page bootstrap gunzips the same fflate format), AND scrub the
// plaintext — then assert NOTHING machine-specific survives in either surface.
//
// The two API failures (a 404 and a 500) are returned by the loopback server
// itself (demo/serve.mjs), so they are real HTTP responses that traverse the
// CDP network stack and are captured deterministically — no Playwright route
// interception, whose Fetch-domain short-circuit could skip Network.responseReceived.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEventsBlob, encodeEventsBlob } from '@tracelane/report';

const here = dirname(fileURLToPath(import.meta.url)); // packages/tracelane-playwright/scripts
const pkgRoot = join(here, '..');
const repoRoot = resolve(pkgRoot, '..', '..'); // .../rrweb-stack
const demoDir = join(pkgRoot, 'demo');
const outDir = join(demoDir, 'demo-out');
const configPath = join(demoDir, 'checkout.config.ts');
const dest = join(
  repoRoot,
  'apps',
  'tracelane-docs',
  'public',
  'demo',
  'playwright-checkout-failure.html',
);
const MAX_BYTES = 25 * 1024 * 1024;
const BLOB_RE = /const EVENTS_GZ_B64 = "([^"]*)";/;

function fail(msg) {
  console.error(`\n[demo:gen] ${msg}`);
  process.exit(1);
}

// 1. Clean output dir so a stale report can't mask a regression.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 2. Boot the loopback server and read the ephemeral port it bound to.
const srv = spawn(process.execPath, [join(demoDir, 'serve.mjs')], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const port = await new Promise((res, rej) => {
  let buf = '';
  const timer = setTimeout(() => rej(new Error('timed out waiting for DEMO_PORT')), 10_000);
  srv.stdout.on('data', (b) => {
    buf += b.toString();
    const m = /DEMO_PORT=(\d+)/.exec(buf);
    if (m) {
      clearTimeout(timer);
      res(m[1]);
    }
  });
  srv.on('exit', (code) => {
    clearTimeout(timer);
    rej(new Error(`demo server exited early (code ${code})`));
  });
});
console.log(`[demo:gen] loopback server on 127.0.0.1:${port}`);

try {
  // 3. Run Playwright against the demo config. The spec fails on purpose, so a
  //    non-zero exit is the EXPECTED, healthy outcome; exit 0 means no report.
  const r = spawnSync(
    process.execPath,
    [
      join(pkgRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test',
      '--config',
      configPath,
    ],
    {
      cwd: pkgRoot,
      stdio: 'inherit',
      env: { ...process.env, TRACELANE_OUT_DIR: outDir, TRACELANE_DEMO_PORT: port },
    },
  );
  if (r.error) fail(`failed to launch Playwright: ${r.error.message}`);
  if (r.status === 0) fail('demo spec PASSED; it must fail so a report is written');

  // 4. Locate the single produced report.
  const reports = readdirSync(outDir).filter((f) => f.endsWith('.html'));
  if (reports.length !== 1) {
    fail(`expected exactly 1 report, got ${reports.length}: ${reports.join(', ')}`);
  }
  const srcPath = join(outDir, reports[0]);
  const rawSize = statSync(srcPath).size;
  if (rawSize >= MAX_BYTES) fail(`report exceeds 25 MB (${rawSize} bytes)`);
  let html = readFileSync(srcPath, 'utf8');

  // 5. Assert the five markers on the ORIGINAL capture (before redaction).
  const m = BLOB_RE.exec(html);
  if (!m) fail('no EVENTS_GZ_B64 blob in report');
  const events = decodeEventsBlob(m[1]);
  const originalJson = JSON.stringify(events);
  const checks = [
    [events.some((e) => e && e.type === 4), 'no Meta event (type 4)'],
    [events.some((e) => e && e.type === 2), 'no rrweb FullSnapshot (type 2)'],
    [originalJson.includes('tracelane.net'), 'network-failure marker [tracelane.net] missing'],
    [
      originalJson.includes('tracelane.nav'),
      'navigation boundary tracelane.nav missing (post-nav capture broken?)',
    ],
    [originalJson.includes('checkout: placing order'), 'post-navigation console line missing'],
    [originalJson.includes('Checkout'), 'post-navigation page-B content (Checkout) missing'],
  ];
  const missing = checks.filter(([ok]) => !ok).map(([, msg]) => msg);
  if (missing.length) fail(`marker assertions FAILED:\n  - ${missing.join('\n  - ')}`);
  console.log('[demo:gen] all 6 capture markers present');

  // 6. Redaction. `redact` maps every machine-specific string to a synthetic,
  //    PII-free equivalent. Order matters: the most specific (loopback origin,
  //    then repo root) before the broader home-dir catch-all.
  const username = userInfo().username;
  const home = homedir();
  const redact = (s) =>
    s
      .split(`http://127.0.0.1:${port}`)
      .join('https://shop.demo')
      .split(`127.0.0.1:${port}`)
      .join('shop.demo')
      .split(`${repoRoot}/`)
      .join('') // /Users/.../rrweb-stack/x → x  (repo-relative, hides the path above the repo)
      .split(repoRoot)
      .join('')
      .split(`${home}/`)
      .join('/home/ci/') // any stray absolute path outside the repo
      .split(home)
      .join('/home/ci')
      .split('127.0.0.1')
      .join('shop.demo') // any loopback authority without the port
      .split('file://')
      .join('https://'); // defensive — shouldn't appear under loopback serving

  // 6a. Redact the decoded events (reaches Meta.href, the DOM tree, and the
  //     network/console plugin payloads inside the gzip blob), then re-encode.
  let eventsJson = redact(originalJson);
  eventsJson = eventsJson.split(username).join('ci'); // username catch-all (decoded JSON only)
  const redactedEvents = JSON.parse(eventsJson); // throws if redaction broke JSON structure
  const newB64 = encodeEventsBlob(redactedEvents);
  const newBlobLine = `const EVENTS_GZ_B64 = "${newB64}";`;

  // 6b. Scrub the plaintext HTML. Replace the old blob with a placeholder first
  //     so the fresh (already-redacted) base64 is never touched by the
  //     username/loopback catch-alls, then restore it last.
  const PLACEHOLDER = '__TL_BLOB_PLACEHOLDER__';
  html = html.replace(BLOB_RE, PLACEHOLDER);
  html = redact(html);
  html = html.split(username).join('ci');
  html = html.replace(PLACEHOLDER, newBlobLine);

  // 7. Dual-surface leak-guard: a raw-HTML grep alone would FALSE-PASS on the
  //    gzipped copy, so we also decode the new blob and scan its JSON.
  const decodedAgain = JSON.stringify(decodeEventsBlob(newB64));
  const needles = ['/Users/', username, home, 'file://', '127.0.0.1'];
  for (const [label, surface] of [
    ['outer HTML', html],
    ['decoded blob', decodedAgain],
  ]) {
    for (const needle of needles) {
      if (surface.includes(needle)) {
        fail(`LEAK GUARD TRIPPED: "${needle}" present in ${label}`);
      }
    }
  }
  console.log(
    '[demo:gen] leak-guard passed — no /Users/, username, home, file://, or 127.0.0.1 in either surface',
  );

  // 8. Final size check + write.
  const finalSize = Buffer.byteLength(html, 'utf8');
  if (finalSize >= MAX_BYTES) fail(`redacted report exceeds 25 MB (${finalSize} bytes)`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, html);
  console.log(`[demo:gen] wrote ${dest} (${finalSize} bytes)`);
} finally {
  srv.kill();
}
