// Reproducible launch-asset renderer (HTML -> Playwright -> PNG).
//
// Renders the launch image assets from a SINGLE shared design system:
//   - A3 recipe heroes (one per recipe, to apps/*-docs/public/recipes/assets/)
//   - A6 CWS promo tile, A7 architecture diagram, A8 hook illustrations
//   - the 1280x640 GitHub social card (re-canvas of the canonical og-card)
// from:
//   - tokens grepped from apps/tracelane-docs/src/styles/global.css
//   - brand marks inlined from assets/brand/*.svg
//   - Fraunces + JetBrains Mono variable woff2 read from @fontsource-variable
//     (the exact cuts the tracelane report ships -> identical, offline, no
//     Google-Fonts network dependency)
//
// NOTE: the share cards (a1/a2/a4) are intentionally disabled — the canonical
// share card is the pre-existing teal assets/og-card.png. See the ALL note below.
//
// Usage:
//   node packages/docs-shared/scripts/_launch-render.mjs            # render all
//   node packages/docs-shared/scripts/_launch-render.mjs a3 social  # subset (substring match on asset name)
//
// Blog-targeted assets (A7/A8) write to $PEEK_BLOG_DIR if set, else a temp dir.
// deviceScaleFactor is fixed at 1 so every PNG lands at EXACTLY its spec'd
// pixel dimensions (OG/share requirement).

import { globSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
// Maintainer sets PEEK_BLOG_DIR to their out-of-repo blog drafts dir; otherwise
// A7/A8 render to a temp dir (path is logged) so the script stays portable.
const BLOG_DIR = process.env.PEEK_BLOG_DIR || join(tmpdir(), 'rrweb-stack-blog-drafts');
const DIAGRAMS = join(BLOG_DIR, 'diagrams');

// ── fonts (local variable woff2 -> data URLs) ──────────────────────────────
function fontDataUrl(glob) {
  const matches = globSync(glob, { cwd: REPO });
  if (!matches.length) throw new Error(`font not found: ${glob}`);
  const buf = readFileSync(join(REPO, matches[0]));
  return `data:font/woff2;base64,${buf.toString('base64')}`;
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
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:100 800;font-display:block;src:url(${JB_N}) format('woff2')}
:root{--serif:'Fraunces',ui-serif,Georgia,serif;--mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace}`;

// ── palettes (verbatim from global.css) ────────────────────────────────────
const DARK = {
  bg: '#1a1a1a',
  fg: '#e8e8e6',
  muted: '#999',
  faint: '#5a5a5a',
  accent: '#e8714b',
  codeBg: '#232321',
  border: '#2c2c2a',
};
const LIGHT = {
  bg: '#fafaf9',
  fg: '#1a1a1a',
  muted: '#5a5a5a',
  faint: '#a8a49c',
  accent: '#d04a1f',
  codeBg: '#f3f1ee',
  border: '#e5e5e2',
};
const MARK_COLOR = { tracelane: '#C2563D', peek: '#4A6B82' };

// ── brand marks ─────────────────────────────────────────────────────────────
const SVG = {
  tracelane: readFileSync(join(REPO, 'assets/brand/sub-tracelane.svg'), 'utf8'),
  peek: readFileSync(join(REPO, 'assets/brand/sub-peek.svg'), 'utf8'),
};
function rawSvg(kind) {
  return SVG[kind].replace(/<\?xml[^>]*\?>\s*/, '').trim();
}
function mark(kind, size) {
  return `<span class="mark" style="width:${size}px;height:${size}px">${rawSvg(kind)}</span>`;
}

// ── document shell ──────────────────────────────────────────────────────────
function doc({ w, h, bg, body, css = '' }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${FONT_FACE}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px}
body{background:${bg};-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-family:var(--mono)}
.mark{display:inline-flex}.mark svg{display:block;width:100%;height:100%}
.card{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${bg}}
.corner{position:absolute;font-family:var(--mono)}
em{font-style:italic}
${css}
</style></head><body><div class="card">${body}</div></body></html>`;
}

// ════════════════════════════════════════════════════════════════════════════
// A1 — blog OG card (1200x630, dark)
// ════════════════════════════════════════════════════════════════════════════
function a1() {
  const p = DARK;
  const body = `
    <div class="corner" style="top:40px;left:48px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${p.faint}">CUBENEST · 2026</div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:56px">
      <h1 style="font-family:var(--serif);font-weight:500;font-size:64px;line-height:1.05;text-align:center;color:${p.fg}">Two tools I built.<br><em>Neither has a signup.</em></h1>
      <div style="margin-top:32px;font-size:16px;letter-spacing:.04em;color:${p.muted};display:flex;align-items:center;justify-content:center">
        <span>tracelane · failed-test recorder</span>
        <span style="margin:0 1.6em;color:${p.faint}">·</span>
        <span>peek · browser companion for AI agents</span>
      </div>
      <div style="margin-top:44px;display:flex;align-items:center;justify-content:center">
        ${mark('tracelane', 72)}
        <span style="width:1px;height:48px;background:${p.border};margin:0 24px"></span>
        ${mark('peek', 72)}
      </div>
    </div>
    <div class="corner" style="bottom:40px;right:48px;font-size:12px;text-transform:uppercase;color:${p.faint}">github.com/Cubenest/rrweb-stack</div>`;
  return {
    name: 'a1-blog-og',
    out: join(BLOG_DIR, 'og-tracelane-peek-launch.png'),
    w: 1200,
    h: 630,
    cap: 250,
    html: doc({ w: 1200, h: 630, bg: p.bg, body }),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A2 — GitHub repo social preview (1280x640, dark)
// ════════════════════════════════════════════════════════════════════════════
function a2() {
  const p = DARK;
  const row = (kind, name, pkgs) => `
    <div style="display:flex;align-items:center;gap:18px;padding:14px 0">
      ${mark(kind, 40)}
      <div style="font-size:14px;letter-spacing:.02em"><span style="color:${p.fg}">${name}</span><span style="color:${p.muted}"> · ${pkgs}</span></div>
    </div>`;
  const body = `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:64px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${p.faint};margin-bottom:26px">CUBENEST · RRWEB-STACK · ALPHA</div>
      <h1 style="font-family:var(--serif);font-weight:500;font-size:52px;line-height:1.08;text-align:center;color:${p.fg}">Failed-test recordings.<br><em>Browser context for AI agents.</em></h1>
      <div style="margin-top:40px;width:560px">
        ${row('tracelane', 'tracelane', '@tracelane/wdio · @tracelane/report')}
        <div style="height:1px;background:${p.border};width:100%"></div>
        ${row('peek', 'peek', '@peekdev/cli · @peekdev/mcp')}
      </div>
    </div>
    <div class="corner" style="bottom:38px;right:48px;font-size:11px;color:${p.faint}">Apache-2.0 · no telemetry · github.com/Cubenest/rrweb-stack</div>`;
  return {
    name: 'a2-repo-social',
    out: join(REPO, 'assets/social/github-repo-card.png'),
    w: 1280,
    h: 640,
    cap: 300,
    html: doc({ w: 1280, h: 640, bg: p.bg, body }),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A4 — docs OG card pair (1200x630, dark) — matched pair, only mark+headline differ
// ════════════════════════════════════════════════════════════════════════════
function a4Card(kind, l1, l2, footer, name, out) {
  const p = DARK;
  const body = `
    <div class="corner" style="top:48px;left:48px">${mark(kind, 56)}</div>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:90px 64px 64px">
      <h1 style="font-family:var(--serif);font-weight:500;font-size:56px;line-height:1.08;text-align:center;color:${p.fg}">${l1}<br><em>${l2}</em></h1>
    </div>
    <div class="corner" style="bottom:40px;right:48px;font-size:12px;color:${p.faint}">${footer}</div>`;
  return { name, out, w: 1200, h: 630, cap: 250, html: doc({ w: 1200, h: 630, bg: p.bg, body }) };
}
function a4t() {
  return a4Card(
    'tracelane',
    'Failed tests, reproduced offline.',
    'A WebdriverIO service. An HTML report. Nothing else.',
    'tracelane.cubenest.in · Apache-2.0',
    'a4-tracelane-og',
    join(REPO, 'apps/tracelane-docs/public/og-card.png'),
  );
}
function a4p() {
  return a4Card(
    'peek',
    'Your AI agent. Your real browser.',
    'A Chrome extension. An MCP server. All local.',
    'peek.cubenest.in · Apache-2.0',
    'a4-peek-og',
    join(REPO, 'apps/peek-docs/public/og-card.png'),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// A6 — CWS promo tile (440x280, dark) — mark + name + one-line descriptor
// ════════════════════════════════════════════════════════════════════════════
function a6() {
  const p = DARK;
  const body = `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
      ${mark('peek', 88)}
      <div style="font-family:var(--serif);font-weight:500;font-size:24px;color:${p.fg};margin-top:16px">peek</div>
      <div style="font-size:11px;color:${p.muted};margin-top:12px;letter-spacing:.02em">browser context for AI agents</div>
    </div>`;
  return {
    name: 'a6-promo-tile',
    out: join(REPO, 'assets/cws/promo-tile-440x280.png'),
    w: 440,
    h: 280,
    cap: 100,
    html: doc({ w: 440, h: 280, bg: p.bg, body }),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A7 — architecture diagram (1600x900, bg #0f1115) — hand-authored
// ════════════════════════════════════════════════════════════════════════════
function a7() {
  const BG = '#0f1115';
  const boxBg = '#15181e';
  const border = '#2c2c2a';
  const wire = '#3a3f47';
  const fg = '#e8e8e6';
  const muted = '#999';
  const faint = '#5a5a5a';
  const topBox = (kind, title, tagline) => `
    <div style="position:relative;width:520px;height:210px;background:${boxBg};border:1px solid ${border};border-radius:5px;padding:30px 34px;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${MARK_COLOR[kind]}"></div>
      <div style="display:flex;align-items:center;gap:18px">
        ${mark(kind, 46)}
        <div style="font-family:var(--serif);font-weight:500;font-size:30px;color:${fg}">${title}</div>
      </div>
      <div style="margin-top:18px;font-size:14px;color:${muted};letter-spacing:.02em">${tagline}</div>
    </div>`;
  const wires = `
    <svg width="1600" height="900" style="position:absolute;inset:0;pointer-events:none">
      <path d="M420 360 V460 H800" fill="none" stroke="${wire}" stroke-width="1.5" stroke-dasharray="5 6"/>
      <path d="M1180 360 V460 H800" fill="none" stroke="${wire}" stroke-width="1.5" stroke-dasharray="5 6"/>
      <path d="M800 460 V556" fill="none" stroke="${wire}" stroke-width="1.5" stroke-dasharray="5 6"/>
      <path d="M792 547 L808 547 L800 560 Z" fill="${wire}"/>
    </svg>`;
  const body = `
    ${wires}
    <div style="position:absolute;left:160px;top:150px">${topBox('tracelane', 'tracelane', 'failed-test recorder')}</div>
    <div style="position:absolute;left:920px;top:150px">${topBox('peek', 'peek', 'AI-agent browser companion')}</div>
    <div style="position:absolute;left:480px;top:560px;width:640px;height:200px;background:${boxBg};border:1px solid ${border};border-radius:5px;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <div style="font-family:var(--mono);font-size:21px;color:${fg};letter-spacing:.01em">@cubenest/rrweb-core</div>
      <div style="margin-top:14px;font-size:14px;color:${muted}">PostHog rrweb fork · vendored · one pinned version</div>
      <div style="margin-top:10px;font-family:var(--mono);font-size:13px;color:${faint}">@posthog/rrweb@0.0.34</div>
    </div>`;
  return {
    name: 'a7-architecture',
    out: join(DIAGRAMS, 'why-one-substrate.png'),
    w: 1600,
    h: 900,
    cap: 220,
    html: doc({ w: 1600, h: 900, bg: BG, body }),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A8 — hook illustrations (800x450, dark) — optional flair
// ════════════════════════════════════════════════════════════════════════════
function a8ci() {
  const p = DARK;
  const body = `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px">
      <div style="width:640px;border:1px solid ${p.border};border-radius:5px;overflow:hidden">
        <div style="padding:12px 18px;border-bottom:1px solid ${p.border};font-size:13px;color:#c2563d;background:${p.bg}">FAILED: e2e/checkout.spec.ts ✗</div>
        <div style="height:208px;background:#f0f0f0;display:flex;align-items:center;justify-content:center">
          <span style="font-size:14px;color:#888">Element not visible: [data-test=submit]</span>
        </div>
      </div>
      <div style="margin-top:22px;font-family:var(--serif);font-style:italic;font-size:18px;color:${p.muted}">the screenshot.</div>
    </div>`;
  return {
    name: 'a8-ci-screenshot',
    out: join(DIAGRAMS, 'hook-ci-screenshot.png'),
    w: 800,
    h: 450,
    cap: 150,
    html: doc({ w: 800, h: 450, bg: p.bg, body }),
  };
}
function a8phone() {
  const p = DARK;
  const panel = (label, text) => `
    <div style="width:300px;border:1px solid ${p.border};border-radius:5px;background:${p.codeBg};padding:18px 20px">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${p.faint}">${label}</div>
      <div style="margin-top:14px;font-size:13px;line-height:1.5;color:${p.fg}">${text}</div>
    </div>`;
  const arc = `
    <svg width="120" height="120" style="position:absolute;left:50%;top:148px;transform:translateX(-50%);pointer-events:none">
      <path d="M6 96 Q60 6 114 96" fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-dasharray="4 6"/>
    </svg>`;
  const body = `
    ${arc}
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px">
      <div style="display:flex;align-items:center;gap:40px">
        ${panel('Dev · terminal', '&gt; the input field flickers when I scroll past 200px')}
        ${panel('AI agent', '&gt; a transform? a reflow? which selector — i can&#39;t see it')}
      </div>
      <div style="margin-top:34px;font-family:var(--serif);font-style:italic;font-size:18px;color:${p.muted}">the network panel is in the other room.</div>
    </div>`;
  return {
    name: 'a8-phone-call',
    out: join(DIAGRAMS, 'hook-phone-call.png'),
    w: 800,
    h: 450,
    cap: 150,
    html: doc({ w: 800, h: 450, bg: p.bg, body }),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A3 — recipe heroes (1200x630). 1 per recipe, to its own site's public dir.
// ════════════════════════════════════════════════════════════════════════════
function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^(\w+):\s*(.*)$/);
    if (!mm) continue;
    const [, k, vRaw] = mm;
    const v = vRaw.trim();
    if (k === 'integrations') {
      const arr = v.match(/^\[(.*)\]$/);
      out.integrations = arr
        ? arr[1]
            .split(',')
            .map((s) => s.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean)
        : [];
    } else {
      out[k] = v.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

function recipeCard(kind, slug, fm, palette) {
  const p = palette;
  const tags = (fm.integrations || []).map((t) => t.toUpperCase()).join('  ·  ');
  const sig = `recipe ── ${slug}`;
  const body = `
    <div class="corner" style="top:48px;left:56px">${mark(kind, 56)}</div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:72px 80px">
      <h1 style="font-family:var(--serif);font-weight:500;font-size:44px;line-height:1.1;color:${p.fg};max-width:1000px">${escapeHtml(fm.title || slug)}</h1>
      <p style="margin-top:22px;font-size:16px;line-height:1.55;color:${p.muted};max-width:880px">${escapeHtml(fm.lede || '')}</p>
    </div>
    <div class="corner" style="bottom:46px;right:56px;font-size:12px;letter-spacing:.08em;color:${p.muted};text-align:right">${tags}</div>
    <div class="corner" style="bottom:46px;left:56px;font-size:12px;color:${p.faint};opacity:.6">${sig}</div>`;
  return body;
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function recipeAssets() {
  const sites = [
    {
      product: 'tracelane',
      dir: join(REPO, 'apps/tracelane-docs/src/content/recipes'),
      outDir: join(REPO, 'apps/tracelane-docs/public/recipes/assets'),
    },
    {
      product: 'peek',
      dir: join(REPO, 'apps/peek-docs/src/content/recipes'),
      outDir: join(REPO, 'apps/peek-docs/public/recipes/assets'),
    },
  ];
  const assets = [];
  for (const site of sites) {
    for (const file of readdirSync(site.dir).filter((f) => f.endsWith('.md'))) {
      const slug = basename(file, '.md');
      const fm = parseFrontmatter(readFileSync(join(site.dir, file), 'utf8'));
      // peek + type:hero -> light palette; everything else dark
      const palette = site.product === 'peek' && fm.type === 'hero' ? LIGHT : DARK;
      const body = recipeCard(site.product, slug, fm, palette);
      assets.push({
        name: `a3-${site.product}-${slug}`,
        out: join(site.outDir, `${slug}.png`),
        w: 1200,
        h: 630,
        cap: 200,
        html: doc({ w: 1200, h: 630, bg: palette.bg, body }),
      });
    }
  }
  return assets;
}

// ── assemble + render ───────────────────────────────────────────────────────
// NOTE: a1 (blog OG), a2 (GitHub repo card) and a4t/a4p (docs OG pair) were
// DROPPED — the project's canonical share card is the pre-existing teal
// `assets/og-card.png` (brand-assets-design.md: "already branded, no change
// needed"). Do NOT re-add a4t/a4p: they write to apps/*-docs/public/og-card.png
// and would clobber the teal card. The defs are kept for reference only.
void a1;
void a2;
void a4t;
void a4p;
const ALL = [a6(), a7(), a8ci(), a8phone(), ...recipeAssets()];

const filters = process.argv.slice(2);
const todo = filters.length ? ALL.filter((a) => filters.some((f) => a.name.includes(f))) : ALL;

console.log(`rendering ${todo.length}/${ALL.length} assets…`);
const browser = await chromium.launch();
let over = 0;
for (const a of todo) {
  const page = await browser.newPage({
    viewport: { width: a.w, height: a.h },
    deviceScaleFactor: 1,
  });
  await page.setContent(a.html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(120);
  mkdirSync(dirname(a.out), { recursive: true });
  await page.screenshot({ path: a.out, clip: { x: 0, y: 0, width: a.w, height: a.h } });
  await page.close();
  const kb = Math.round(statSync(a.out).size / 1024);
  const flag = a.cap && kb > a.cap ? `  ⚠ OVER ${a.cap}KB` : '';
  if (flag) over++;
  console.log(
    `  ${a.name.padEnd(40)} ${a.w}x${a.h}  ${String(kb).padStart(4)}KB${flag}  -> ${a.out.replace(`${REPO}/`, '')}`,
  );
}
// ── social card: re-canvas the canonical teal og-card.png to 1280x640 ────────
// GitHub's repo social-preview slot wants 1280x640 (2:1); the canonical
// og-card is 1200x630 (1.91:1, the universal OG ratio). The teal card is an
// AI-generated raster with no re-renderable source, so we DON'T recreate it —
// we center the canonical pixels on a 1280x640 canvas filled with the card's
// own edge colour (auto-sampled), so the extra ~40px/side is seamless and the
// content stays inside the 1200x630 safe area (survives both 2:1 and 1.91:1).
async function renderSocialCard() {
  const ogB64 = readFileSync(join(REPO, 'assets/og-card.png')).toString('base64');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1280px;height:640px}
body{display:flex;align-items:center;justify-content:center;overflow:hidden}
img.card{width:1200px;height:630px;display:block}canvas{display:none}
</style></head><body>
<canvas id="c" width="1280" height="640"></canvas>
<img class="card" id="card" src="data:image/png;base64,${ogB64}">
<script>
const img=document.getElementById('card');
function go(){try{const ctx=document.getElementById('c').getContext('2d');ctx.drawImage(img,0,0);const p=ctx.getImageData(3,3,1,1).data;const bg='rgb('+p[0]+','+p[1]+','+p[2]+')';document.documentElement.style.background=bg;document.body.style.background=bg;}catch(e){document.body.style.background='#0f1115';}window.__bgReady=true;}
if(img.complete)go();else img.onload=go;
</script></body></html>`;
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__bgReady === true', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  const out = join(REPO, 'assets/social/github-repo-card.png');
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1280, height: 640 } });
  await page.close();
  console.log(
    `  social-github-repo-card                  1280x640  ${Math.round(statSync(out).size / 1024)}KB  -> ${out.replace(`${REPO}/`, '')}`,
  );
}
if (filters.length === 0 || filters.includes('social')) await renderSocialCard();

await browser.close();
console.log(`done. ${todo.length} rendered, ${over} over size cap.`);
