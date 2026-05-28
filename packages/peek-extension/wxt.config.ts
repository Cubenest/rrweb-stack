import { join } from 'node:path';
import { defineConfig } from 'wxt';
import { buildRecorder } from './scripts/build-recorder.mjs';

// peek Chrome MV3 extension — WXT generates `manifest.json` from this config
// plus the entrypoint files in `entrypoints/`. Do NOT hand-write manifest.json.
//
// The manifest values below are load-bearing and come verbatim from
// ADR-0008 (per-site activation, no `<all_urls>` in host_permissions) and
// P2 PRD §A.5 (the concrete manifest). The privacy posture hinges on
// `host_permissions: []` + `optional_host_permissions` requested at runtime —
// see src/activation/. Keep these in sync with the ADR if either changes.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // WXT discovers entrypoints under entrypoints/ (background.ts, sidepanel/).
  // srcDir defaults to the project root; do NOT set it to '.' explicitly —
  // that collides with WXT's vite-node entrypoint loader (Invalid URL).
  outDir: '.output',
  manifest: {
    name: 'peek',
    description: 'Capture your real browser session and expose it to AI coding agents via MCP.',
    homepage_url: 'https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-extension',
    minimum_chrome_version: '116',
    // ADR-0008: NO `<all_urls>` / `https://*/*` in host_permissions. The broad
    // pattern lives in optional_host_permissions and is requested per-site from
    // a user gesture (see src/activation/request.ts). This is the decision that
    // keeps the install card clean and the CWS review fast.
    host_permissions: [],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    permissions: [
      'activeTab',
      'scripting',
      'storage',
      'alarms',
      'tabs',
      'sidePanel',
      'nativeMessaging',
      'offscreen',
      'webRequest',
      // P-14 (2026-05-28 QA walk): `debugger` MUST be in static `permissions`,
      // NOT `optional_permissions`. Chrome 121+ removed `debugger` from the
      // allowed set of MV3 optional permissions; Chrome silently drops the
      // entry and `chrome.permissions.request({ permissions: ['debugger'] })`
      // returns false. Original intent (ADR-0010: keep Deep capture off by
      // default + behind a yellow banner) is unchanged — the side-panel
      // toggle still controls when `chrome.debugger.attach()` runs. What
      // changes is the install card: it now shows the "This extension can
      // read and change all your data on the websites you visit" warning
      // upfront. That's the post-Chrome-121 cost of supporting Deep capture
      // at all; the only alternative is dropping the feature entirely.
      'debugger',
    ],
    action: {
      default_title: 'peek',
    },
    // web_accessible_resources for the recorder scripts (P2 PRD §A.5). The
    // bundles themselves (MAIN-world rrweb recorder + ISOLATED relay bridge)
    // land in chunk 3d-2; the manifest declares their names now so the slots
    // are reserved. WXT bundles entrypoints/injected/*.ts to injected/*.js.
    web_accessible_resources: [
      {
        resources: ['rrweb-recorder.js', 'main-world-bridge.js'],
        matches: ['<all_urls>'],
      },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
  hooks: {
    // Build the MAIN-world rrweb recorder as a self-contained IIFE AFTER WXT's
    // Vite build finishes (Task 3.19, P2 PRD §A.2). It is deliberately NOT a
    // WXT/Vite entrypoint: Vite emits ES modules and CRXJS loads content
    // scripts via dynamic import + chrome.runtime.getURL, neither of which
    // works in a `world: 'MAIN'` script (crxjs discussion #643). esbuild
    // (`format: 'iife'`) inlines every transitive dep of @cubenest/rrweb-core
    // into one classic script with no import/export. The manifest already
    // reserves `rrweb-recorder.js` in web_accessible_resources; this writes the
    // file the SW injects via chrome.scripting.executeScript.
    //
    // assert-recorder-iife.mjs (CI + `pnpm build`) re-builds and enforces the
    // IIFE invariant independently of this hook.
    'build:done': async (wxt) => {
      const outDir = wxt.config.outDir;
      const outFile = join(outDir, 'rrweb-recorder.js');
      await buildRecorder(outFile);
      wxt.logger.info(`[peek] MAIN-world recorder IIFE → ${outFile}`);
    },
  },
});
