import { defineConfig } from 'wxt';

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
    ],
    // `debugger` is OPTIONAL, not static (deliberate reconciliation: ADR-0010's
    // opt-in intent wins over §A.5's literal static list). ADR-0010 keeps
    // chrome.debugger OFF by default — a static `debugger` permission shows
    // every install "This extension may monitor and control all your browser
    // activity", for a feature that's off by default. Chunk 3d-3 (Task 3.26)
    // requests it from the Deep-capture toggle's user gesture via
    // `chrome.permissions.request({ permissions: ['debugger'] })`, the same
    // gesture-time pattern used for optional_host_permissions.
    //
    // WXT's bundled `ManifestOptionalPermission` type excludes `debugger` (a
    // stale restriction — Chrome MV3 DOES allow `debugger` in
    // `optional_permissions` and grants it at runtime via
    // `chrome.permissions.request`). The @ts-expect-error is scoped to this one
    // line and will start failing (prompting cleanup) if WXT fixes the type.
    // @ts-expect-error -- 'debugger' is valid in MV3 optional_permissions; WXT's type omits it.
    optional_permissions: ['debugger'],
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
});
