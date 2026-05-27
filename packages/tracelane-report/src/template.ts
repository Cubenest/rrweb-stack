// HTML composition for the self-contained report (P1 PRD §F.1).
//
// `renderReportHtml` assembles the single-file document from already-prepared
// pieces (the caller — build-report.ts — does the extraction + encoding). This
// module owns the static shell: the report CSS, the metadata header markup, the
// panel containers, and the in-page bootstrap script. The large vendored assets
// (player UMD/CSS, fflate UMD) and the data payloads are passed in.

import { loadFflateGunzipSource, loadPlayerCss, loadPlayerUmd } from './assets';
import { escapeHtml, serializeForScript } from './html';
import { renderMetaHeader } from './metadata';
import type { ConsoleEntry, NetworkEntry } from './panels';
import type { ReportMeta } from './types';

/** Everything `renderReportHtml` needs; build-report.ts prepares it. */
export interface ReportTemplateData {
  meta: ReportMeta;
  /** base64(gzip(events)) — decompressed in-page for the player. */
  eventsGzB64: string;
  /** Extracted console panel rows (Task 2.10). */
  console: ConsoleEntry[];
  /** Extracted network panel rows (Task 2.10). */
  network: NetworkEntry[];
  /** Pre-rendered "Copy as Markdown for AI paste" payload (Task 2.12). */
  markdown: string;
  /** Whether the events were pruned to fit the size budget (ADR-0005 banner). */
  pruned: boolean;
}

/** Report shell CSS (~ a few KB). Kept terse; no external fonts or assets. */
const SHELL_CSS = `
:root { color-scheme: light dark; --fg:#1a1a1a; --bg:#fff; --muted:#666; --border:#e2e2e2; --accent:#2563eb; --err:#dc2626; --warn:#d97706; --panel:#fafafa; }
@media (prefers-color-scheme: dark){ :root { --fg:#e6e6e6; --bg:#161616; --muted:#9a9a9a; --border:#2c2c2c; --accent:#60a5fa; --err:#f87171; --warn:#fbbf24; --panel:#1e1e1e; } }
* { box-sizing: border-box; }
body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:var(--fg); background:var(--bg); }
header.meta { padding:12px 16px; border-bottom:1px solid var(--border); }
header.meta h1 { margin:0 0 6px; font-size:16px; }
header.meta .status { display:inline-block; padding:1px 8px; border-radius:10px; font-size:12px; font-weight:600; text-transform:uppercase; }
header.meta .status.failed,header.meta .status.broken { background:var(--err); color:#fff; }
header.meta .status.passed { background:#16a34a; color:#fff; }
header.meta .status.skipped { background:var(--muted); color:#fff; }
header.meta dl { display:grid; grid-template-columns:max-content 1fr; gap:2px 12px; margin:8px 0 0; font-size:13px; }
header.meta dt { color:var(--muted); }
header.meta dd { margin:0; word-break:break-word; }
header.meta .error { margin-top:8px; padding:8px; border-left:3px solid var(--err); background:var(--panel); white-space:pre-wrap; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
.banner { padding:6px 16px; background:var(--warn); color:#1a1a1a; font-size:13px; }
.toolbar { padding:8px 16px; border-bottom:1px solid var(--border); }
button.copy-md { font:inherit; padding:6px 12px; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:6px; cursor:pointer; }
button.copy-md:active { opacity:.8; }
main { display:flex; gap:0; align-items:stretch; min-height:60vh; }
#player { flex:1 1 auto; min-width:0; padding:12px; overflow:auto; }
aside#panels { flex:0 0 360px; border-left:1px solid var(--border); display:flex; flex-direction:column; overflow:hidden; }
aside#panels section { display:flex; flex-direction:column; min-height:0; flex:1 1 50%; }
aside#panels h2 { margin:0; padding:8px 12px; font-size:13px; background:var(--panel); border-bottom:1px solid var(--border); position:sticky; top:0; }
.rows { overflow:auto; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
.row { padding:4px 12px; border-bottom:1px solid var(--border); white-space:pre-wrap; word-break:break-word; }
.row.error { color:var(--err); } .row.warn { color:var(--warn); }
.row .lvl { font-weight:600; margin-right:6px; }
.row .st { font-weight:600; margin-right:6px; } .row .st4,.row .st5 { color:var(--err); }
.empty { padding:12px; color:var(--muted); font-style:italic; }
`;

/**
 * The in-page bootstrap (runs at view time, plain ES5-ish JS so it executes in
 * any browser without a build step). Reads the embedded payloads, decompresses
 * the events with the inlined fflate, mounts rrweb-player, renders the panels,
 * and wires the copy-as-markdown button. Authored as a single string so it ships
 * verbatim in a `<script>` — it must not reference any TS/Node symbol.
 */
const BOOTSTRAP = `
(function () {
  function decodeEvents(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var json = fflate.strFromU8(fflate.gunzipSync(bytes));
    return JSON.parse(json);
  }

  var events = decodeEvents(EVENTS_GZ_B64);

  // rrweb-player needs at least two events to compute a timeline; guard so a
  // truncated/empty capture degrades to a message instead of throwing.
  var playerEl = document.getElementById('player');
  if (events.length >= 2 && typeof rrwebPlayer !== 'undefined') {
    new rrwebPlayer({ target: playerEl, props: { events: events, showController: true, autoPlay: false } });
  } else {
    playerEl.innerHTML = '<p class="empty">Not enough recorded events to replay.</p>';
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderConsole(container, rows) {
    if (!rows.length) { container.appendChild(el('div', 'empty', 'No console output captured.')); return; }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var row = el('div', 'row ' + (r.level || 'log'));
      row.appendChild(el('span', 'lvl', (r.level || 'log').toUpperCase()));
      row.appendChild(document.createTextNode(r.message));
      container.appendChild(row);
    }
  }

  function renderNetwork(container, rows) {
    if (!rows.length) { container.appendChild(el('div', 'empty', 'No failed network requests captured.')); return; }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var row = el('div', 'row');
      row.appendChild(el('span', 'st st' + String(r.status).charAt(0), String(r.status)));
      row.appendChild(document.createTextNode((r.method ? r.method + ' ' : '') + r.url));
      container.appendChild(row);
    }
  }

  renderConsole(document.getElementById('console-rows'), CONSOLE);
  renderNetwork(document.getElementById('network-rows'), NETWORK);

  var btn = document.getElementById('copy-md');
  if (btn) {
    btn.addEventListener('click', function () {
      var done = function () { var t = btn.textContent; btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = t; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(MARKDOWN).then(done, function () { window.prompt('Copy the Markdown below:', MARKDOWN); });
      } else {
        window.prompt('Copy the Markdown below:', MARKDOWN);
      }
    });
  }
})();
`;

/** Compose the full self-contained HTML document. */
export function renderReportHtml(data: ReportTemplateData): string {
  const { meta, eventsGzB64, console: consoleRows, network, markdown, pruned } = data;

  const title = `tracelane — ${meta.spec ?? '(no spec)'} :: ${meta.title} (${meta.status})`;
  const banner = pruned
    ? '<div class="banner">Some recorded events were pruned to fit the 25 MB report budget — replay may skip detail.</div>'
    : '';

  // Data payloads embedded as JS consts, all escaped for inline-script safety.
  // The events blob is base64 (already inline-safe); the rest go through
  // serializeForScript to neutralise any `</script>` in user data.
  const dataScript =
    `const META = ${serializeForScript(meta)};\n` +
    `const EVENTS_GZ_B64 = "${eventsGzB64}";\n` +
    `const CONSOLE = ${serializeForScript(consoleRows)};\n` +
    `const NETWORK = ${serializeForScript(network)};\n` +
    `const MARKDOWN = ${serializeForScript(markdown)};`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${loadPlayerCss()}</style>
<style>${SHELL_CSS}</style>
</head>
<body>
${renderMetaHeader(meta)}
${banner}
<div class="toolbar"><button id="copy-md" class="copy-md" type="button">Copy as Markdown for AI paste</button></div>
<main>
<section id="player" aria-label="Session replay"></section>
<aside id="panels">
<section aria-label="Console"><h2>Console</h2><div id="console-rows" class="rows"></div></section>
<section aria-label="Network"><h2>Network errors</h2><div id="network-rows" class="rows"></div></section>
</aside>
</main>
<script>${loadFflateGunzipSource()}</script>
<script>${loadPlayerUmd()}</script>
<script>${dataScript}</script>
<script>${BOOTSTRAP}</script>
</body>
</html>`;
}
