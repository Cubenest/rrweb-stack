// HTML composition for the self-contained report (P1 PRD §F.1 + Phase 6
// editorial-postmortem revamp).
//
// `renderReportHtml` assembles the single-file document from already-prepared
// pieces (the caller — build-report.ts — does the extraction + encoding). This
// module owns the static shell: the report CSS, the hero header markup, the
// player + tabbed-panel containers, the in-page bootstrap script, and the
// FAB. The large vendored assets (player UMD/CSS, fflate UMD, both variable
// fonts) and the data payloads are passed in.

import {
  loadFflateGunzipSource,
  loadFrauncesItalic,
  loadFrauncesNormal,
  loadJetBrainsMonoNormal,
  loadPlayerCss,
  loadPlayerUmd,
} from './assets.js';
import { escapeHtml, serializeForScript } from './html.js';
import { renderHero } from './metadata.js';
import type { ConsoleEntry, NetworkEntry } from './panels.js';
import type { ReportMeta } from './types.js';

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
  /** Total recorded event count (Phase 6 meta-strip). */
  eventCount: number;
  /** Earliest event timestamp (wall-clock ms) or 0 if no events. */
  firstTs: number;
  /** Latest event timestamp (wall-clock ms) or 0 if no events. Treated as the
   *  "failure" moment for the timeline marker when the test failed. */
  lastTs: number;
}

/**
 * Compose the SHELL_CSS at build time so the base64-encoded woff2 strings can
 * be interpolated into `@font-face` rules. Returns a single CSS string the
 * report's `<style>` tag wraps. Kept as a function (not a const) so the woff2
 * reads happen at build time, not import time — matters because the loaders
 * touch the filesystem.
 *
 * Aesthetic: editorial postmortem. Dark slate background, off-white text,
 * teal-and-amber accent palette. Fraunces serif for the hero headline + section
 * heads (italic-emphasized clause carries the failure colour), JetBrains Mono
 * variable for every data row + the eyebrow + the meta strip + the panels.
 */
function buildShellCss(): string {
  const frauncesNormal = loadFrauncesNormal();
  const frauncesItalic = loadFrauncesItalic();
  const jbMonoNormal = loadJetBrainsMonoNormal();

  // Inline @font-face declarations — each `url(data:...)` is a base64 woff2 that
  // resolves with no network request. font-display:block is intentional: the
  // serif headline is the first thing the eye lands on and a fallback flash
  // would betray the design (it's <50 ms anyway, the data URL is local).
  const fontFaces = `
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-display: block;
  font-weight: 100 900;
  src: url(data:font/woff2;base64,${frauncesNormal}) format('woff2');
}
@font-face {
  font-family: 'Fraunces';
  font-style: italic;
  font-display: block;
  font-weight: 100 900;
  src: url(data:font/woff2;base64,${frauncesItalic}) format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-display: block;
  font-weight: 100 800;
  src: url(data:font/woff2;base64,${jbMonoNormal}) format('woff2');
}`;

  // CSS variables + reset + every component in document order. ~6 KB minified.
  const styles = `
:root {
  color-scheme: dark;
  --bg: #0f1115;
  --surface: #171a20;
  --surface-2: #1d2027;
  --border: #2a2e36;
  --border-strong: #383d47;
  --text: #e7e5e1;
  --muted: #8a92a0;
  --muted-strong: #b8bfca;
  --teal: #5eead4;
  --teal-dim: rgba(94, 234, 212, 0.18);
  --amber: #f5a364;
  --amber-dim: rgba(245, 163, 100, 0.18);
  --warn: #f0c674;
  --serif: 'Fraunces', ui-serif, Georgia, serif;
  --mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
a { color: var(--teal); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ===== Hero: "What failed" ===== */
.hero {
  padding: 48px 48px 32px;
  border-bottom: 1px solid var(--border);
  background:
    radial-gradient(1200px 400px at -10% -20%, var(--amber-dim), transparent 50%),
    radial-gradient(800px 300px at 110% 120%, var(--teal-dim), transparent 50%),
    var(--bg);
}
.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.eyebrow .dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--amber);
  box-shadow: 0 0 0 4px var(--amber-dim);
  animation: pulse 2.6s ease-in-out infinite;
}
.eyebrow .status { color: var(--amber); font-weight: 700; }
.eyebrow .status.passed { color: var(--teal); }
.eyebrow .status.skipped { color: var(--muted); }
.eyebrow .status.broken { color: var(--amber); }
.eyebrow .sep { color: var(--border-strong); }

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 4px var(--amber-dim); }
  50%      { box-shadow: 0 0 0 8px rgba(245, 163, 100, 0.06); }
}

h1.what {
  font-family: var(--serif);
  font-weight: 600;
  font-size: clamp(28px, 4vw, 44px);
  line-height: 1.15;
  letter-spacing: -0.02em;
  margin: 0 0 12px;
  color: var(--text);
  max-width: 56ch;
}
h1.what em {
  font-style: italic;
  color: var(--amber);
  font-weight: 500;
}

.error-message {
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.65;
  color: var(--muted-strong);
  padding: 14px 16px;
  border-left: 2px solid var(--amber);
  background: rgba(245, 163, 100, 0.05);
  margin: 18px 0 24px;
  white-space: pre-wrap;
  max-width: 90ch;
  overflow-x: auto;
}

.meta-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  border-top: 1px solid var(--border);
  margin: 24px -48px -32px;
  padding: 16px 48px;
  background: rgba(0, 0, 0, 0.15);
}
.meta-strip .item {
  padding: 4px 24px 4px 0;
  margin-right: 24px;
  border-right: 1px solid var(--border);
  font-size: 12px;
}
.meta-strip .item:last-child { border-right: 0; margin-right: 0; }
.meta-strip .label {
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 10px;
  font-weight: 600;
  display: block;
  margin-bottom: 2px;
}
.meta-strip .value { color: var(--text); font-weight: 500; }
.meta-strip .value a { color: var(--teal); font-weight: 500; }
.meta-strip .value code {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--teal);
  background: transparent;
  padding: 0;
}

/* ===== Banner (size pruned) ===== */
.banner {
  padding: 10px 48px;
  background: rgba(240, 198, 116, 0.12);
  border-bottom: 1px solid var(--border);
  color: var(--warn);
  font-size: 12px;
}

/* ===== Main: replay + investigation ===== */
main.investigation {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(420px, 1fr);
  min-height: 70vh;
  border-bottom: 1px solid var(--border);
}

/* Replay column */
.replay {
  padding: 24px 32px;
  border-right: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}
.replay-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}
.replay-header h2 {
  font-family: var(--serif);
  font-weight: 500;
  font-style: italic;
  font-size: 20px;
  margin: 0;
  color: var(--text);
}
.replay-header .timestamp {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.04em;
}
#player {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  position: relative;
  overflow: hidden;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
#player .empty {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
  text-align: center;
  padding: 16px;
}

/* Investigation panels column */
.panels {
  background: var(--surface);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  padding: 14px 20px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  border: 0;
  background: transparent;
  border-bottom: 2px solid transparent;
  text-transform: lowercase;
  letter-spacing: 0.04em;
  transition: color 0.15s ease, border-color 0.15s ease;
  font-weight: 500;
  white-space: nowrap;
}
.tab:hover { color: var(--muted-strong); }
.tab.active {
  color: var(--text);
  border-bottom-color: var(--teal);
}
.tab .count {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--border);
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
}
.tab.active .count { background: var(--teal-dim); color: var(--teal); }

.panel-toolbar {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.panel-filter {
  flex: 1;
  min-width: 160px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 12px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 12px;
  transition: border-color 0.15s ease;
}
.panel-filter:focus { outline: none; border-color: var(--teal); }
.panel-filter::placeholder { color: var(--muted); }
.filter-chip {
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}
.filter-chip:hover { border-color: var(--border-strong); color: var(--muted-strong); }
.filter-chip.active {
  border-color: var(--amber);
  color: var(--amber);
  background: var(--amber-dim);
}

.panel-pane { display: none; flex-direction: column; min-height: 0; flex: 1; }
.panel-pane.active { display: flex; }

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.panel-empty {
  padding: 24px 16px;
  color: var(--muted);
  font-style: italic;
  text-align: center;
  font-size: 12px;
}

/* Time-sync: rows whose data-time is past the current playback time. */
.panel-content .row.is-future { display: none; }
.panel-content .row { cursor: pointer; }

/* Pending placeholder shown when rows exist but the playhead hasn't reached
   any of them yet. Sibling of .panel-content inside .panel-pane. */
.panel-pending {
  padding: 24px;
  text-align: center;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.02em;
}
.panel-pending.is-hidden { display: none; }

/* Tab badge: <current> in default color, "/ <total>" in --muted. */
.tab .count-total {
  color: var(--muted);
  margin-left: 4px;
  font-weight: normal;
}
.row {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  display: grid;
  grid-template-columns: max-content max-content 1fr;
  gap: 14px;
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.55;
  transition: background 0.1s ease;
}
.row.error { background: rgba(245, 163, 100, 0.04); }
.row.hidden { display: none; }
.row .ts { color: var(--muted); font-size: 10.5px; padding-top: 1px; white-space: nowrap; }
.row .lvl {
  font-weight: 700;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding-top: 2px;
  white-space: nowrap;
}
.row.error .lvl { color: var(--amber); }
.row.warn .lvl  { color: var(--warn); }
.row.log .lvl,
.row.info .lvl,
.row.debug .lvl { color: var(--muted); }
.row .msg { color: var(--text); word-break: break-word; white-space: pre-wrap; }
.row .msg .method { color: var(--muted-strong); font-weight: 600; margin-right: 6px; }
.row.row-net .lvl.st-4,
.row.row-net .lvl.st-5 { color: var(--amber); }
.row.row-net .lvl.st-0 { color: var(--amber); } /* net error */

/* "Coming soon" pane content (Actions / Timeline tabs reserved for follow-ups) */
.coming-soon {
  padding: 32px 16px;
  text-align: center;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.coming-soon strong { color: var(--text); font-weight: 600; }

/* Floating action button: Copy as Markdown */
.fab {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 22px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(94, 234, 212, 0.06);
  transition: all 0.2s ease;
}
.fab:hover {
  border-color: var(--teal);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(94, 234, 212, 0.3);
  transform: translateY(-1px);
}
.fab.copied {
  border-color: var(--teal);
  color: var(--teal);
  box-shadow: 0 0 0 4px var(--teal-dim), 0 8px 32px rgba(0, 0, 0, 0.4);
}
.fab .icon {
  width: 14px; height: 14px;
  border: 1.5px solid var(--teal);
  border-radius: 3px;
  position: relative;
  flex-shrink: 0;
}
.fab .icon::after {
  content: '';
  position: absolute;
  top: -3px; left: 2px;
  width: 10px; height: 11px;
  border: 1.5px solid var(--teal);
  border-radius: 2px;
  background: var(--surface);
  transition: opacity 0.2s ease;
}
.fab.copied .icon { border-color: var(--teal); }
.fab.copied .icon::after { opacity: 0; }
.fab.copied .icon::before {
  content: '';
  position: absolute;
  top: 1px; left: 4px;
  width: 4px; height: 8px;
  border-right: 1.5px solid var(--teal);
  border-bottom: 1.5px solid var(--teal);
  transform: rotate(45deg);
}

/* Footer */
footer.attrib {
  padding: 32px 48px;
  border-top: 1px solid var(--border);
  text-align: center;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
}
footer.attrib a { color: var(--muted-strong); }
footer.attrib em {
  font-family: var(--serif);
  font-style: italic;
  font-size: 12px;
  color: var(--muted-strong);
}

/* Mobile: stack the replay above panels; panels become full-width. */
@media (max-width: 900px) {
  .hero { padding: 32px 24px 24px; }
  .meta-strip { margin: 16px -24px -24px; padding: 12px 24px; gap: 4px 0; }
  .meta-strip .item { border-right: 0; padding: 4px 0; margin-right: 24px; }
  .banner { padding: 10px 24px; }
  main.investigation { grid-template-columns: 1fr; }
  .replay { border-right: 0; border-bottom: 1px solid var(--border); padding: 20px 24px; }
  .panels { min-height: 50vh; }
  .fab { right: 16px; bottom: 16px; padding: 12px 18px; font-size: 11px; }
  h1.what { font-size: 28px; }
  footer.attrib { padding: 24px 24px; }
}

/* rrweb-player wrapper: ensure it fills #player without overflow weirdness.
   The controller has a white background; default text inherits our dark-theme
   --text (near-white), making 2x/4x/8x speed buttons and the "skip inactive"
   label invisible. Restore a dark text color scoped to the player controls. */
#player .rr-player { background: var(--surface) !important; }
#player .rr-controller__btns button { color: #11103e; }
#player .rr-controller__btns button.active { color: #fff; }
#player .rr-controller .switch .label { color: #11103e; }
`;

  return fontFaces + styles;
}

/**
 * The in-page bootstrap (runs at view time, plain ES5-ish JS so it executes in
 * any browser without a build step). Reads the embedded payloads, decompresses
 * the events with the inlined fflate, mounts rrweb-player, renders the panels,
 * wires up tab switching + filter input + filter chips, and animates the
 * Copy-as-Markdown FAB. Authored as a single string so it ships verbatim in a
 * `<script>` — it must not reference any TS/Node symbol.
 */
const BOOTSTRAP = `
(function () {
  function decodeEvents(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length === 0) return [];
    var json = fflate.strFromU8(fflate.gunzipSync(bytes));
    return JSON.parse(json);
  }

  var events = decodeEvents(EVENTS_GZ_B64);

  // ---- rrweb-player mount ------------------------------------------------
  var playerEl = document.getElementById('player');
  var rrPlayer = null;
  if (events.length >= 2 && typeof rrwebPlayer !== 'undefined') {
    // Size the player to fill its container, preserving the recording's
    // aspect ratio. rrweb-player's defaults (1024x576) overflow most layouts.
    var recAspect = (META.viewport && META.viewport.width && META.viewport.height)
      ? META.viewport.width / META.viewport.height
      : 16 / 10;
    var containerW = playerEl.clientWidth || 1024;
    var maxIframeH = Math.max(window.innerHeight - 360, 280);
    var iframeH = Math.min(Math.round(containerW / recAspect), maxIframeH);
    var iframeW = Math.min(containerW, Math.round(iframeH * recAspect));
    rrPlayer = new rrwebPlayer({
      target: playerEl,
      props: {
        events: events,
        width: iframeW,
        height: iframeH,
        showController: true,
        autoPlay: false,
      },
    });
  } else {
    var msg = document.createElement('div');
    msg.className = 'empty';
    msg.textContent = events.length === 0
      ? 'No recorded events — the test crashed before the recorder produced a snapshot.'
      : 'Only one event recorded — not enough timeline to replay.';
    playerEl.appendChild(msg);
  }

  // ---- Helpers -----------------------------------------------------------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // "+1:23.456" relative timestamp from the session start.
  function fmtRelTs(ts, firstTs) {
    if (!firstTs || !ts) return '+0:00.000';
    var delta = Math.max(0, ts - firstTs);
    var seconds = delta / 1000;
    var minutes = Math.floor(seconds / 60);
    var rem = seconds - minutes * 60;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var ms = String(Math.floor((rem - Math.floor(rem)) * 1000));
    while (ms.length < 3) ms = '0' + ms;
    return '+' + minutes + ':' + pad(Math.floor(rem)) + '.' + ms;
  }

  // ---- Panel rendering ---------------------------------------------------
  function renderConsole(container, rows, firstTs) {
    if (!rows.length) {
      container.appendChild(el('div', 'panel-empty', 'No console output captured.'));
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var lvl = (r.level || 'log').toLowerCase();
      var row = el('div', 'row is-future ' + lvl);
      var relMs = firstTs ? Math.max(0, r.timestamp - firstTs) : 0;
      row.setAttribute('data-time', String(relMs));
      row.appendChild(el('span', 'ts', fmtRelTs(r.timestamp, firstTs)));
      row.appendChild(el('span', 'lvl', lvl));
      row.appendChild(el('span', 'msg', r.message));
      row.setAttribute('data-level', lvl);
      row.setAttribute('data-text', r.message.toLowerCase());
      container.appendChild(row);
    }
  }

  function renderNetwork(container, rows, firstTs) {
    if (!rows.length) {
      container.appendChild(el('div', 'panel-empty', 'No failed network requests captured.'));
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var row = el('div', 'row row-net is-future error');
      var relMs = firstTs ? Math.max(0, r.timestamp - firstTs) : 0;
      row.setAttribute('data-time', String(relMs));
      row.appendChild(el('span', 'ts', fmtRelTs(r.timestamp, firstTs)));
      var stCls = 'lvl st-' + String(r.status).charAt(0);
      row.appendChild(el('span', stCls, String(r.status)));
      var msg = el('span', 'msg');
      if (r.method) {
        var m = el('span', 'method', r.method);
        msg.appendChild(m);
      }
      msg.appendChild(document.createTextNode(r.url));
      row.appendChild(msg);
      var text = (r.method || '') + ' ' + r.url + ' ' + String(r.status);
      row.setAttribute('data-text', text.toLowerCase());
      container.appendChild(row);
    }
  }

  renderConsole(document.getElementById('console-rows'), CONSOLE, FIRST_TS);
  renderNetwork(document.getElementById('network-rows'), NETWORK, FIRST_TS);

  // ---- Time-sync: reveal rows as playback advances ----------------------
  function tickPanels(currentMs) {
    var t = Math.max(0, Math.floor(currentMs || 0));
    var names = ['console', 'network'];
    for (var n = 0; n < names.length; n++) {
      var name = names[n];
      var container = document.getElementById(name + '-rows');
      var pending = document.getElementById(name + '-pending');
      var badgeCurrent = document.querySelector(
        '.tab[data-pane="pane-' + name + '"] .count'
      );
      if (!container) continue;
      var rows = container.querySelectorAll('.row');
      // Detect "was at bottom" BEFORE flipping classes so auto-scroll only
      // triggers when the user hasn't scrolled up to inspect older entries.
      var wasAtBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <= 20;
      var visibleCount = 0;
      var hasAnyRows = rows.length > 0;
      for (var i = 0; i < rows.length; i++) {
        var rowTime = parseInt(rows[i].getAttribute('data-time') || '0', 10);
        var isFuture = rowTime > t;
        rows[i].classList.toggle('is-future', isFuture);
        if (!isFuture && !rows[i].classList.contains('hidden')) visibleCount++;
      }
      if (badgeCurrent) badgeCurrent.textContent = String(visibleCount);
      if (pending) {
        // Pending placeholder shows when rows exist but none visible yet.
        pending.classList.toggle('is-hidden', !hasAnyRows || visibleCount > 0);
      }
      if (wasAtBottom && visibleCount > 0) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }

  if (rrPlayer && typeof rrPlayer.addEventListener === 'function') {
    rrPlayer.addEventListener('ui-update-current-time', function (e) {
      // rrweb-player's CustomEvent shape: { payload: <ms> } in alpha.4. If
      // the bundled version ever changes shape, fall back to reading the
      // replayer directly.
      var payload = e && e.payload;
      if (typeof payload !== 'number') {
        try { payload = rrPlayer.getReplayer().getCurrentTime(); } catch (_) { payload = 0; }
      }
      tickPanels(payload);
    });
  }
  tickPanels(0);

  // ---- Tab switching -----------------------------------------------------
  var tabs = document.querySelectorAll('.tab');
  var panes = document.querySelectorAll('.panel-pane');
  for (var t = 0; t < tabs.length; t++) {
    (function (tab) {
      tab.addEventListener('click', function () {
        var targetId = tab.getAttribute('data-pane');
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
        for (var j = 0; j < panes.length; j++) {
          panes[j].classList.toggle('active', panes[j].id === targetId);
        }
        tab.classList.add('active');
      });
    })(tabs[t]);
  }

  // ---- Per-pane filter input + level chips ------------------------------
  function wireFilters(paneEl) {
    var input = paneEl.querySelector('.panel-filter');
    var chips = paneEl.querySelectorAll('.filter-chip');
    var rows = paneEl.querySelectorAll('.row');

    var activeLevels = {};
    for (var c = 0; c < chips.length; c++) {
      if (chips[c].classList.contains('active')) {
        activeLevels[chips[c].getAttribute('data-level') || ''] = true;
      }
    }

    function applyFilter() {
      var q = (input ? input.value : '').trim().toLowerCase();
      var anyActive = false;
      for (var k in activeLevels) { if (activeLevels[k]) { anyActive = true; break; } }
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var text = row.getAttribute('data-text') || '';
        var level = row.getAttribute('data-level') || '';
        // Level filter: if any chips are active, row must match one of them.
        // Network rows have no level — treated as "always shown" by level filter.
        var levelOk = !anyActive || !level || activeLevels[level];
        var textOk = !q || text.indexOf(q) !== -1;
        row.classList.toggle('hidden', !(levelOk && textOk));
      }
    }

    if (input) input.addEventListener('input', applyFilter);
    for (var c2 = 0; c2 < chips.length; c2++) {
      (function (chip) {
        chip.addEventListener('click', function () {
          var lvl = chip.getAttribute('data-level') || '';
          if (chip.classList.contains('active')) {
            chip.classList.remove('active');
            activeLevels[lvl] = false;
          } else {
            chip.classList.add('active');
            activeLevels[lvl] = true;
          }
          applyFilter();
        });
      })(chips[c2]);
    }
    applyFilter();
  }

  for (var p = 0; p < panes.length; p++) wireFilters(panes[p]);

  // ---- Copy-as-Markdown FAB ----------------------------------------------
  var fab = document.getElementById('copy-md');
  if (fab) {
    var fabLabel = fab.querySelector('.label');
    var resetTimer = null;
    fab.addEventListener('click', function () {
      var done = function () {
        fab.classList.add('copied');
        if (fabLabel) fabLabel.textContent = 'Copied to clipboard';
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(function () {
          fab.classList.remove('copied');
          if (fabLabel) fabLabel.textContent = 'Copy as Markdown for AI';
        }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(MARKDOWN).then(done, function () {
          window.prompt('Copy the Markdown below:', MARKDOWN);
        });
      } else {
        window.prompt('Copy the Markdown below:', MARKDOWN);
      }
    });
  }
})();
`;

/**
 * Self-marketing footer (Phase 5 indirect-virality artifact).
 *
 * Every report shared in a PR comment or attached to a JIRA ticket becomes a
 * tracked acquisition channel — the Loom / Calendly / Statuspage compounding
 * pattern. UTM params let us attribute click-through downstream; the link
 * targets the repo's `packages/tracelane-wdio` directory because the install
 * command (`npm i @tracelane/wdio`) is what we want a reader to see first
 * (per the research's "link to the install command, not the marketing site"
 * rule).
 */
const FOOTER_HTML =
  '<footer class="attrib">' +
  '  <em>Generated by</em> <a href="https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-wdio?utm_source=tracelane-report&utm_medium=html-footer&utm_campaign=indirect-virality" rel="noopener">tracelane</a> — self-contained HTML test-failure replays. No SaaS, no telemetry, no signup.' +
  '</footer>';

function formatRelativeMs(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const r = Math.floor(s - m * 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** Compose the full self-contained HTML document. */
export function renderReportHtml(data: ReportTemplateData): string {
  const {
    meta,
    eventsGzB64,
    console: consoleRows,
    network,
    markdown,
    pruned,
    eventCount,
    firstTs,
    lastTs,
  } = data;

  const title = `tracelane — ${meta.spec ?? '(no spec)'} :: ${meta.title} (${meta.status})`;

  // Banner only when the events were pruned to fit the size cap (ADR-0005).
  const banner = pruned
    ? '<div class="banner">Some recorded events were pruned to fit the 25 MB report budget — replay may skip detail.</div>'
    : '';

  const consoleCount = consoleRows.length;
  const networkCount = network.length;

  // Data payloads embedded as JS consts, all escaped for inline-script safety.
  const dataScript =
    `const META = ${serializeForScript(meta)};\n` +
    `const EVENTS_GZ_B64 = "${eventsGzB64}";\n` +
    `const CONSOLE = ${serializeForScript(consoleRows)};\n` +
    `const NETWORK = ${serializeForScript(network)};\n` +
    `const MARKDOWN = ${serializeForScript(markdown)};\n` +
    `const FIRST_TS = ${firstTs};\n` +
    `const LAST_TS = ${lastTs};`;

  const sessionRangeText =
    firstTs && lastTs && lastTs > firstTs
      ? `+0:00 → +${formatRelativeMs(lastTs - firstTs)} · ${eventCount.toLocaleString('en-US')} events`
      : `${eventCount.toLocaleString('en-US')} events`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${loadPlayerCss()}</style>
<style>${buildShellCss()}</style>
</head>
<body>
${renderHero(meta, eventCount)}
${banner}
<main class="investigation">
  <section class="replay" aria-label="Session replay">
    <div class="replay-header">
      <h2>Replay</h2>
      <span class="timestamp">${escapeHtml(sessionRangeText)}</span>
    </div>
    <div id="player" role="img" aria-label="rrweb player"></div>
  </section>
  <aside class="panels" aria-label="Investigation panels">
    <div class="tabs" role="tablist">
      <button class="tab active" type="button" role="tab" data-pane="pane-console">
        Console <span class="count">0</span><span class="count-total">/ ${consoleCount}</span>
      </button>
      <button class="tab" type="button" role="tab" data-pane="pane-network">
        Network <span class="count">0</span><span class="count-total">/ ${networkCount}</span>
      </button>
      <button class="tab" type="button" role="tab" data-pane="pane-actions">
        Actions
      </button>
      <button class="tab" type="button" role="tab" data-pane="pane-timeline">
        Timeline
      </button>
    </div>

    <div class="panel-pane active" id="pane-console" role="tabpanel">
      <div class="panel-toolbar">
        <input type="text" class="panel-filter" placeholder="Filter console…" aria-label="Filter console messages" />
        <button class="filter-chip" type="button" data-level="error">errors</button>
        <button class="filter-chip" type="button" data-level="warn">warn</button>
      </div>
      <div id="console-rows" class="panel-content"></div>
      <div class="panel-pending" id="console-pending">Console output will appear during playback.</div>
    </div>

    <div class="panel-pane" id="pane-network" role="tabpanel">
      <div class="panel-toolbar">
        <input type="text" class="panel-filter" placeholder="Filter URLs…" aria-label="Filter network requests" />
      </div>
      <div id="network-rows" class="panel-content"></div>
      <div class="panel-pending" id="network-pending">Network errors will appear during playback.</div>
    </div>

    <div class="panel-pane" id="pane-actions" role="tabpanel">
      <div class="coming-soon">
        <strong>Actions panel — coming soon</strong>
        <span>User-input event extraction lands in a follow-up changeset.</span>
        <span>Use the rrweb-player scrubber to walk through actions manually.</span>
      </div>
    </div>

    <div class="panel-pane" id="pane-timeline" role="tabpanel">
      <div class="coming-soon">
        <strong>Timeline panel — coming soon</strong>
        <span>Use the rrweb-player scrubber above to navigate the recording today.</span>
        <span>A richer event-by-event timeline lands in a follow-up changeset.</span>
      </div>
    </div>
  </aside>
</main>

<button class="fab" id="copy-md" type="button" aria-label="Copy report as Markdown for AI">
  <span class="icon" aria-hidden="true"></span>
  <span class="label">Copy as Markdown for AI</span>
</button>

<script>${loadFflateGunzipSource()}</script>
<script>${loadPlayerUmd()}</script>
<script>${dataScript}</script>
<script>${BOOTSTRAP}</script>
${FOOTER_HTML}
</body>
</html>`;
}
