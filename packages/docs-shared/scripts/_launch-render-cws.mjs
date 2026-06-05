// Reproducible CWS-screenshot renderer.
//
// Produces the 5 Chrome Web Store screenshots (1280x800) for the peek listing.
//
// Approach (honest "real captures"):
//   - Side-panel states (01,02,05) are the REAL built sidepanel React UI: we
//     serve packages/peek-extension/chrome-mv3 over localhost and inject a
//     precise `chrome` API shim (addInitScript) that drives each target state.
//     The rendered pixels are the genuine components + CSS; only the data the
//     app reads (active tab, enabled origins, permission level, recorder stats)
//     is seeded. Storage keys/shapes mirror src/constants + src/permissions.
//   - Agent panes (03,04) are editorial composites of REAL data: the ten real
//     MCP tool names, and the genuine get_dom_snapshot output of a real
//     example.com session (zero PII — the canonical placeholder page).
//   - Each inner capture is composited onto a 1280x800 canvas: a 64px caption
//     strip (#1a1a1a) over a #fafaf9 page (magazine letterbox).
//
// Run: node packages/docs-shared/scripts/_launch-render-cws.mjs

import { globSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const EXT_DIR = join(REPO, 'packages/peek-extension/.output/chrome-mv3');
const OUT_DIR = join(REPO, 'assets/cws/screenshots');

// ── fonts (shared with the main harness) ────────────────────────────────────
function fontDataUrl(glob) {
  const m = globSync(glob, { cwd: REPO });
  if (!m.length) throw new Error(`font not found: ${glob}`);
  return `data:font/woff2;base64,${readFileSync(join(REPO, m[0])).toString('base64')}`;
}
const FR_N = fontDataUrl(
  'node_modules/.pnpm/@fontsource-variable+fraunces@*/node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2',
);
const FR_I = fontDataUrl(
  'node_modules/.pnpm/@fontsource-variable+fraunces@*/node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2',
);
const JB_N = fontDataUrl(
  'node_modules/.pnpm/@fontsource-variable+jetbrains-mono@*/node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
);
const FONT_FACE = `
@font-face{font-family:'Fraunces';font-style:normal;font-weight:100 900;font-display:block;src:url(${FR_N}) format('woff2')}
@font-face{font-family:'Fraunces';font-style:italic;font-weight:100 900;font-display:block;src:url(${FR_I}) format('woff2')}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:100 800;font-display:block;src:url(${JB_N}) format('woff2')}`;

// ── real data ────────────────────────────────────────────────────────────────
const REAL_DOM_HTML = `<!DOCTYPE html><html lang="en"><head><title>Example Domain</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body { background: rgb(238, 238, 238); width: 60vw; margin: 15vh auto; font-family: system-ui, sans-serif; }h1 { font-size: 1.5em; }div { opacity: 0.8; }a:link, a:visited { color: rgb(51, 68, 136); }</style></head><body><div><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission. Avoid use in operations.</p><p><a href="https://iana.org/domains/example">Learn more</a></p></div>\n</body></html>`;

const TOOLS = [
  ['list_recent_sessions', 'read', 'List recently recorded sessions, newest first'],
  ['get_session_summary', 'read', 'Narrative: pages, clicks, navigations, error counts'],
  ['get_session_console_errors', 'read', 'Console errors recorded during a session'],
  ['get_session_network_errors', 'read', 'Failed network responses in a session'],
  ['get_user_action_before_error', 'read', 'What the user did right before an error'],
  ['get_dom_snapshot', 'read', 'Reconstruct the DOM (or a subtree) at a timestamp'],
  ['query_dom_history', 'read', 'Query how the DOM changed over time'],
  ['generate_playwright_repro', 'read', 'Turn a session into a Playwright test'],
  ['execute_action', 'gated', 'Act in the browser — gated by permission level'],
  ['request_authorization', 'gated', 'Ask the user to authorize an action'],
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── chrome API shim injected before the side-panel app boots ─────────────────
function chromeMockScript(state) {
  return `(function(){
  const store = ${JSON.stringify(state.store)};
  const activeTab = ${JSON.stringify(state.activeTab)};
  const recorderStats = ${JSON.stringify(state.recorderStats)};
  const noop = function(){};
  const evt = function(){ return { addListener: noop, removeListener: noop, hasListener: function(){return false;} }; };
  function get(keys){
    var out = {};
    if (keys == null) out = Object.assign({}, store);
    else if (typeof keys === 'string') { if (keys in store) out[keys] = store[keys]; }
    else if (Array.isArray(keys)) { keys.forEach(function(k){ if (k in store) out[k] = store[k]; }); }
    else if (typeof keys === 'object') { Object.keys(keys).forEach(function(k){ out[k] = (k in store) ? store[k] : keys[k]; }); }
    return Promise.resolve(out);
  }
  function set(items){ Object.assign(store, items); return Promise.resolve(); }
  const area = { get: get, set: set, remove: function(){return Promise.resolve();}, clear: function(){return Promise.resolve();}, onChanged: evt() };
  const chrome = {
    runtime: {
      id: 'peekdevlocalpreviewaaaaaaaaaaaaaa',
      getURL: function(p){ return p; },
      getManifest: function(){ return { version: '0.1.0', manifest_version: 3 }; },
      sendMessage: function(msg){
        if (msg && msg.type === 'getRecorderStats') return Promise.resolve(recorderStats);
        if (msg && msg.type === 'getNativeHostState') return Promise.resolve({ state: 'connected' });
        return Promise.resolve(undefined);
      },
      onMessage: evt(),
      connect: function(){ return { postMessage: noop, onMessage: evt(), onDisconnect: evt(), disconnect: noop }; },
      lastError: undefined,
    },
    storage: { sync: area, local: area, session: area, onChanged: evt() },
    tabs: {
      query: function(){ return Promise.resolve(activeTab ? [activeTab] : []); },
      get: function(){ return Promise.resolve(activeTab); },
      onActivated: evt(),
      onUpdated: evt(),
    },
    permissions: {
      request: function(){ return Promise.resolve(true); },
      contains: function(){ return Promise.resolve(true); },
      remove: function(){ return Promise.resolve(true); },
      onAdded: evt(), onRemoved: evt(),
    },
    i18n: { getMessage: function(k){ return k; } },
    action: { onClicked: evt() },
    sidePanel: { open: function(){ return Promise.resolve(); }, setOptions: function(){ return Promise.resolve(); } },
  };
  window.chrome = chrome;
  window.browser = chrome;
})();`;
}

const EXAMPLE_TAB = {
  id: 42,
  windowId: 1,
  url: 'https://example.com/',
  title: 'Example Domain',
  active: true,
};
const STATE_FRESH = {
  store: { 'peek:enabledOrigins': [], 'peek:permissionLevels': {}, 'peek:deepCaptureOrigins': [] },
  activeTab: EXAMPLE_TAB,
  recorderStats: { domMutations: 0, consoleLogs: 0, networkRequests: 0 },
};
const STATE_ACTIVE = {
  store: {
    'peek:enabledOrigins': ['https://example.com'],
    'peek:permissionLevels': { 'https://example.com': 1 },
    'peek:deepCaptureOrigins': [],
  },
  activeTab: EXAMPLE_TAB,
  recorderStats: { domMutations: 127, consoleLogs: 14, networkRequests: 9 },
};

// ── static server for chrome-mv3 ─────────────────────────────────────────────
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
};
function startServer() {
  return new Promise((res) => {
    const server = createServer((req, resp) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        const filePath = join(EXT_DIR, urlPath === '/' ? 'sidepanel.html' : urlPath);
        if (!filePath.startsWith(EXT_DIR)) {
          resp.writeHead(403);
          resp.end();
          return;
        }
        const buf = readFileSync(filePath);
        resp.writeHead(200, {
          'content-type': TYPES[extname(filePath)] || 'application/octet-stream',
        });
        resp.end(buf);
      } catch {
        resp.writeHead(404);
        resp.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

// ── capture a real side-panel state, return a PNG data URL ───────────────────
async function capturePanel(browser, baseUrl, state, selector) {
  const page = await browser.newPage({
    viewport: { width: 420, height: 1000 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.addInitScript(chromeMockScript(state));
  await page.goto(`${baseUrl}/sidepanel.html`, { waitUntil: 'networkidle' });
  try {
    await page.waitForSelector('.peek-panel', { timeout: 8000 });
  } catch {
    const body = await page.evaluate(() => document.body.innerHTML.slice(0, 400));
    console.error('  ⚠ panel did not mount. errors:', errors, '\n  body:', body);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(900); // let EventCount poll + render
  const target = page.locator(selector);
  const buf = await target.screenshot({ type: 'png' });
  if (errors.length) console.error('  (page reported:', errors.slice(0, 3), ')');
  await page.close();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// ── composite builders ───────────────────────────────────────────────────────
const COMPOSITE_BASE = `
${FONT_FACE}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1280px;height:800px}
body{font-family:'JetBrains Mono',ui-monospace,monospace}
.canvas{position:relative;width:1280px;height:800px;background:#fafaf9;overflow:hidden}
.strip{position:absolute;top:0;left:0;right:0;height:64px;background:#1a1a1a;display:flex;align-items:center;justify-content:space-between;padding:0 40px}
.strip .title{font-family:'Fraunces',serif;font-weight:500;font-size:22px;color:#e8e8e6}
.strip .frame{font-size:13px;color:#999;letter-spacing:.04em}
.stage{position:absolute;top:64px;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;gap:56px;padding:48px 64px}
.panel-shot{max-height:648px;max-width:380px;width:auto;height:auto;border:1px solid #e2e0db;border-radius:10px;box-shadow:0 18px 48px rgba(20,20,20,.14);background:#1f2733}
.agent{width:720px;background:#1a1a1a;border:1px solid #2c2c2a;border-radius:10px;overflow:hidden;box-shadow:0 18px 48px rgba(20,20,20,.16)}
.agent-bar{display:flex;align-items:center;gap:8px;padding:13px 18px;background:#232321;border-bottom:1px solid #2c2c2a}
.agent-bar .d{width:11px;height:11px;border-radius:50%}
.agent-bar .r{background:#e06a55}.agent-bar .y{background:#e0b24a}.agent-bar .g{background:#6aa86a}
.agent-bar .t{margin-left:12px;font-size:12.5px;color:#999;letter-spacing:.02em}
.agent-body{padding:22px 24px;font-size:13.5px;line-height:1.5;color:#e8e8e6}
.cmt{color:#5a5a5a}
.toolrow{display:flex;align-items:baseline;gap:12px;padding:6px 0}
.toolname{color:#e8714b;min-width:230px}
.tag{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:4px;border:1px solid #2c2c2a}
.tag.read{color:#8aa6b2;border-color:#33414a}
.tag.gated{color:#e0b24a;border-color:#5a4a20}
.tooldesc{color:#999;font-size:12.5px}
.call{color:#e8e8e6}.call .fn{color:#e8714b}.call .arg{color:#8aa6b2}
.result{margin-top:14px;background:#121210;border:1px solid #2c2c2a;border-radius:7px;padding:16px 18px;color:#bdbdba;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:hidden}
.result .k{color:#8aa6b2}
.prompt{color:#6aa86a}`;

function composite({ title, frame, stage }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${COMPOSITE_BASE}</style></head>
<body><div class="canvas">
  <div class="strip"><span class="title">${esc(title)}</span><span class="frame">${frame}</span></div>
  <div class="stage">${stage}</div>
</div></body></html>`;
}

function toolsPane() {
  const rows = TOOLS.map(
    ([n, t, d]) =>
      `<div class="toolrow"><span class="toolname">${n}</span><span class="tag ${t}">${t === 'gated' ? 'gated' : 'read-only'}</span></div><div class="tooldesc" style="padding:0 0 4px 0">${esc(d)}</div>`,
  ).join('');
  return `<div class="agent"><div class="agent-bar"><span class="d r"></span><span class="d y"></span><span class="d g"></span><span class="t">AI agent · MCP client → peek</span></div>
  <div class="agent-body"><div class="cmt"># peek exposes ten tools to your agent — read freely, write only when you allow it</div>
  <div style="margin-top:12px">${rows}</div></div></div>`;
}

function domPane() {
  const pretty = REAL_DOM_HTML.replace('</head>', '</head>\n')
    .replace('<body>', '\n<body>')
    .replace('</div>', '</div>');
  return `<div class="agent" style="width:880px"><div class="agent-bar"><span class="d r"></span><span class="d y"></span><span class="d g"></span><span class="t">AI agent · MCP client → peek</span></div>
  <div class="agent-body">
    <div><span class="prompt">›</span> <span class="call"><span class="fn">get_dom_snapshot</span>(<span class="arg">sessionId</span>=s_192d0ab0…, <span class="arg">ts</span>=1780311212000)</span></div>
    <div class="cmt" style="margin-top:8px">↳ baseSnapshotTs 1780311205620 · mutationsApplied 0 · origin https://example.com</div>
    <div class="result">${esc(pretty)}</div>
  </div></div>`;
}

// ── run ──────────────────────────────────────────────────────────────────────
const { server, port } = await startServer();
const baseUrl = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();

console.log('capturing real side-panel states…');
const shotFresh = await capturePanel(browser, baseUrl, STATE_FRESH, '.peek-panel');
const shotActive = await capturePanel(browser, baseUrl, STATE_ACTIVE, '.peek-panel');
const shotAudit = await capturePanel(
  browser,
  baseUrl,
  STATE_ACTIVE,
  'section[aria-labelledby="peek-agent-heading"]',
);

const SHOTS = [
  {
    name: '01-permissions',
    title: 'Enable peek per-origin. Five permission levels. Off by default.',
    frame: '1 of 5',
    stage: `<img class="panel-shot" src="${shotFresh}">`,
  },
  {
    name: '02-side-panel-recording',
    title: 'Recording shows live activity in the side panel.',
    frame: '2 of 5',
    stage: `<img class="panel-shot" src="${shotActive}">`,
  },
  {
    name: '03-mcp-tools',
    title: 'Ten tools: eight read-only, two gated by your permission level.',
    frame: '3 of 5',
    stage: `<img class="panel-shot" style="max-height:560px" src="${shotActive}">${toolsPane()}`,
  },
  {
    name: '04-get-dom-snapshot',
    title: 'The agent can reconstruct the DOM at any past timestamp.',
    frame: '4 of 5',
    stage: domPane(),
  },
  {
    name: '05-audit-log',
    title: 'Control what your agent can do — per site, per level.',
    frame: '5 of 5',
    stage: `<div style="background:#1f2733;border:1px solid #e2e0db;border-radius:10px;box-shadow:0 18px 48px rgba(20,20,20,.14);padding:6px"><img style="display:block;max-width:560px;border-radius:6px" src="${shotAudit}"></div>`,
  },
];

mkdirSync(OUT_DIR, { recursive: true });
console.log('compositing 1280x800 screenshots…');
for (const s of SHOTS) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  await page.setContent(composite(s), { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(150);
  const out = join(OUT_DIR, `${s.name}.png`);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1280, height: 800 } });
  await page.close();
  console.log(
    `  ${s.name.padEnd(26)} ${Math.round(statSync(out).size / 1024)}KB  -> ${out.replace(`${REPO}/`, '')}`,
  );
}

await browser.close();
server.close();
console.log('done.');
