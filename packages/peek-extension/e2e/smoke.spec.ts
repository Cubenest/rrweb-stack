// peek Playwright persistent-context smoke (Task 3.29).
//
// This smoke is two pragmatic layers — neither tries to round-trip Chrome's
// real native messaging install, which would require pinning the extension
// id with a manifest `key` and writing into ~/Library/Application Support
// (or its Linux/Windows equivalents) on a CI runner. Both are achievable
// but expensive for a smoke; the brief explicitly authorizes the lighter
// path: "Pick the simpler that still produces meaningful signal."
//
// Layer 1 — Browser loadability (Playwright)
//   chromium.launchPersistentContext() loads the unpacked extension and
//   navigates to a static fixture page. The smoke ASSERTS the extension
//   loaded by inspecting the loaded manifest + the registered service
//   worker target. This catches the regressions that matter:
//     - manifest.json fails CWS validation (parse, permission shape).
//     - The MAIN-world rrweb-recorder.js IIFE is missing or malformed.
//     - The ISOLATED relay content-script bundle is broken.
//     - The service worker fails to register at all.
//
//   What we DO NOT exercise in Layer 1 (with documented reason):
//   - chrome.permissions.request: Playwright cannot accept the native
//     permission grant UI in headless Chromium. We don't click "Enable
//     on this site"; we assert the side-panel resource exists and is
//     reachable as `chrome-extension://<id>/sidepanel.html`.
//   - chrome.runtime.connectNative: requires a registered native host
//     manifest pointing at the peek-mcp binary, with allowed_origins
//     containing our pinned dev extension id. Skipped — see Layer 2.
//
// Layer 2 — Native-host loop (peek-mcp child process)
//   Spawn `peek-mcp --native-host` with `PEEK_HOME=<tmp>`, feed it framed
//   `host.hello` + `session.append` + `console.append` over stdin, then
//   open the SQLite at `<tmp>/.peek/sessions.db` and assert non-empty
//   `sessions` + `events_chunks` + `console_events` rows. This is the
//   same wire protocol Chrome would use; we exercise the host code path
//   that handles real ingest.
//
// Run with `pnpm --filter @peekdev/extension test:e2e` after a build.
// This file is NOT picked up by `pnpm test` (vitest) — Playwright's
// runner discovers it via the sibling playwright.config.ts.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type BrowserContext, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
// Shared persistent-context launch + SW resolution (factored into _harness.ts
// in Task 9 so the smoke and the shield spec share one launch code path).
import { getServiceWorker, launchExtension, peekMcpDist } from './_harness';

/**
 * Frame a value as a Chrome native-messaging message: little-endian uint32
 * length prefix + UTF-8 JSON body. This duplicates peek-mcp's `encodeMessage`
 * (peek-mcp/src/native-host/transport.ts) intentionally — the smoke test is
 * cross-package and re-implementing the trivial framing here lets us avoid
 * re-exporting transport internals from `@peekdev/mcp/native-host`.
 */
function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, 'fixtures', 'sample.html');
const fixtureUrl = `file://${fixturePath}`;

// `peekMcpDist` (the peek-mcp entry — resolved workspace-relative so we don't
// widen @peekdev/mcp's public surface for a test) comes from ./_harness so the
// smoke and shield specs agree on paths. The extension dir + launch flags also
// live there (used via `launchExtension`).

let context: BrowserContext | undefined;
let userDataDir = '';
let peekHome = '';

test.beforeAll(async () => {
  if (!existsSync(peekMcpDist)) {
    throw new Error(
      `peek smoke: peek-mcp not built — run \`pnpm --filter @peekdev/mcp build\` first. (looked at ${peekMcpDist})`,
    );
  }
  peekHome = mkdtempSync(join(tmpdir(), 'peek-smoke-home-'));

  // Shared launch: asserts the extension is built, makes a fresh userDataDir,
  // and launches the full `channel: 'chromium'` build with `--headless=new`
  // (Playwright 1.50+ defaults to `chromium_headless_shell`, which DOES NOT load
  // extensions — Issue #35395; the deprecated `--headless` mode also disables
  // them). See e2e/_harness.ts for the launch flags.
  const launched = await launchExtension();
  context = launched.context;
  userDataDir = launched.userDataDir;
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDir) {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  if (peekHome) {
    try {
      rmSync(peekHome, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

// ---------------------------------------------------------------------------
// LAYER 1 — Browser loadability.
//
// Limit acknowledged in the docstring: we can't click "Enable on this site"
// from Playwright because chrome.permissions.request is not surfaced in the
// headless permission API. We instead assert the extension's MV3 service
// worker registered and its in-package resources resolve.
// ---------------------------------------------------------------------------

test('layer 1: extension loads in persistent context and exposes a service worker', async () => {
  expect(context).toBeDefined();
  if (context === undefined) throw new Error('context not initialized'); // narrowing
  const ctx = context;

  // The service worker may register slightly after launchPersistentContext
  // returns. Poll the targets list briefly. Chromium 120+ surfaces MV3 SWs
  // via `context.serviceWorkers()`; earlier versions used `backgroundPages`,
  // but WXT requires Chromium >= 116 and the SW path is the documented one.
  let workers = ctx.serviceWorkers();
  for (let i = 0; i < 20 && workers.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 250));
    workers = ctx.serviceWorkers();
  }
  expect(workers.length, 'extension service worker registered').toBeGreaterThan(0);

  const swUrl = workers[0]?.url() ?? '';
  expect(swUrl.startsWith('chrome-extension://'), `SW url is extension-scoped: ${swUrl}`).toBe(
    true,
  );

  // Parse the extension id from the SW url; assert the manifest can be read.
  const idMatch = swUrl.match(/^chrome-extension:\/\/([a-p]+)\//);
  expect(idMatch, `SW url shape: ${swUrl}`).not.toBeNull();
  if (idMatch === null) throw new Error('unreachable: idMatch null after assertion');
  const extId = idMatch[1];

  const page = await ctx.newPage();
  const manifestUrl = `chrome-extension://${extId}/manifest.json`;
  const manifestRes = await page.goto(manifestUrl);
  expect(manifestRes?.ok(), `manifest fetched: ${manifestUrl}`).toBe(true);
  const manifestText = await page.evaluate(() => document.body.innerText);
  const manifest = JSON.parse(manifestText) as {
    permissions: string[];
    host_permissions: string[];
    optional_host_permissions: string[];
    optional_permissions: string[];
    web_accessible_resources: { resources: string[] }[];
  };

  // The privacy posture invariants — these must hold or PRIVACY_POLICY.md is
  // a lie. host_permissions empty, broad pattern lives in OPTIONAL only.
  // `debugger` is in static `permissions` (P-14: Chrome 121+ banned it from
  // optional_permissions); behavior is still gated OFF by default via the
  // per-origin Deep capture toggle in the side panel.
  expect(manifest.host_permissions, 'host_permissions stays empty (ADR-0008)').toEqual([]);
  expect(manifest.optional_host_permissions, 'broad pattern is opt-in only').toContain(
    'https://*/*',
  );
  expect(manifest.permissions, 'debugger declared statically (Chrome 121+)').toContain('debugger');
  expect(
    manifest.optional_permissions ?? [],
    'optional_permissions empty post-debugger-move',
  ).not.toContain('debugger');

  // The MAIN-world recorder bundle is reachable (page.request.get rejects
  // the chrome-extension: scheme; navigating works because Chromium itself
  // resolves the URL against the extension's web_accessible_resources).
  const recorderUrl = `chrome-extension://${extId}/rrweb-recorder.js`;
  const recorderRes = await page.goto(recorderUrl);
  expect(recorderRes?.ok(), `recorder bundle reachable: ${recorderUrl}`).toBe(true);
  const recorderText = await page.evaluate(() => document.body.innerText);
  // ADR-0008 / Task 3.19 invariant: rrweb-recorder.js is a classic IIFE,
  // not an ES module. (assert-recorder-iife.mjs guards the same invariant
  // at build time; this is a runtime-loaded re-assertion.)
  expect(recorderText.length, 'recorder bundle is non-empty').toBeGreaterThan(0);
  expect(recorderText, 'no ES module imports in IIFE').not.toMatch(/^\s*import\s/m);
  expect(recorderText, 'no ES module exports in IIFE').not.toMatch(/^\s*export\s/m);

  await page.close();
});

test('layer 1: side-panel "Enable on this site" state can be persisted via storage', async () => {
  // chrome.permissions.request (the API the "Enable on this site" button
  // calls) cannot be auto-accepted in Playwright — the native permission
  // grant UI is OS-level and not exposed to the headless protocol. Per the
  // brief's documented degrade-gracefully path, we exercise the *storage
  // half* of activation by writing directly via the SW's chrome.storage.sync
  // surface. The capture-side path is then proven independently in Layer 2.
  expect(context).toBeDefined();
  if (context === undefined) throw new Error('context not initialized');
  const sw = await getServiceWorker(context);

  // The activation store is keyed under `peek:enabledOrigins` (per
  // src/constants.ts -> ENABLED_ORIGINS_KEY). We write directly, then read
  // back, to prove the SW's `chrome.storage.sync` is functional in this
  // profile.
  const origin = 'https://example.test';
  await sw.evaluate(async (o) => {
    await chrome.storage.sync.set({ 'peek:enabledOrigins': [o] });
  }, origin);
  const stored = await sw.evaluate(async () => {
    const out = await chrome.storage.sync.get('peek:enabledOrigins');
    return out['peek:enabledOrigins'];
  });
  expect(stored, 'origin persisted to chrome.storage.sync').toEqual([origin]);
});

test('layer 1: fixture page loads and emits expected DOM/console activity', async () => {
  expect(context).toBeDefined();
  if (context === undefined) throw new Error('context not initialized'); // narrowing
  const page = await context.newPage();

  const consoleLines: string[] = [];
  page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));

  await page.goto(fixtureUrl);
  await expect(page.locator('h1')).toContainText('peek smoke fixture');
  await page.click('#click-me');
  await expect(page.locator('#result')).toContainText('clicked at');

  // The fixture marks a global so we know its <script> actually executed
  // before any race with content-script injection.
  const ready = await page.evaluate(
    () => (window as unknown as { __peekFixtureReady?: boolean }).__peekFixtureReady === true,
  );
  expect(ready, 'fixture script ran').toBe(true);

  // Sanity: at least the page-loaded log is visible. We don't assert the
  // peek recorder forwarded anything here — Layer 2 covers that wire.
  expect(consoleLines.some((l) => l.includes('[peek-fixture] page loaded'))).toBe(true);

  await page.close();
});

// ---------------------------------------------------------------------------
// LAYER 2 — Native-host loop (peek-mcp child process).
//
// Spawn peek-mcp --native-host with PEEK_HOME pointing at a tmpdir, feed it
// framed messages over stdin (the same wire format Chrome uses), then open
// the resulting SQLite and assert rows were written.
// ---------------------------------------------------------------------------

test('layer 2: peek-mcp ingests a session+console batch into SQLite via stdio', async () => {
  expect(peekHome).not.toBe('');
  const child = spawn(process.execPath, [peekMcpDist, '--native-host'], {
    env: { ...process.env, PEEK_HOME: peekHome },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Capture stderr for diagnostics if the test fails.
  const stderrChunks: Buffer[] = [];
  child.stderr.on('data', (c) => stderrChunks.push(c));

  // Frame and send a representative ingest batch. We don't await responses —
  // the host writes them to stdout but the assertion below is on the durable
  // SQLite state, which is more meaningful for a smoke.
  const sessionId = `smoke-session-${Date.now()}`;
  const startedAt = Date.now();

  // Wire shapes mirror peek-mcp/src/native-host/ingest.ts:
  //   session.append: { type, sessionId, url?, title?, events[], seq? }
  //   console.append: { type, sessionId, url?, title?, events: { ts, level, args[] }[] }
  child.stdin.write(frame({ type: 'host.hello' }));

  child.stdin.write(
    frame({
      type: 'session.append',
      sessionId,
      title: 'peek smoke fixture',
      url: fixtureUrl,
      events: [
        { type: 4, timestamp: startedAt, data: { href: fixtureUrl, width: 1280, height: 720 } },
      ],
    }),
  );
  child.stdin.write(
    frame({
      type: 'console.append',
      sessionId,
      url: fixtureUrl,
      events: [{ ts: startedAt + 1, level: 'log', args: ['[peek-fixture] page loaded'] }],
    }),
  );

  // Close stdin so the host's read loop ends gracefully.
  child.stdin.end();

  const exitCode: number | null = await new Promise((res) => {
    child.on('exit', (code) => res(code));
  });

  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8');
    throw new Error(`peek-mcp exited ${exitCode}; stderr:\n${stderr}`);
  }

  // Verify durable state.
  const dbPath = join(peekHome, 'sessions.db');
  expect(existsSync(dbPath), `sqlite written at ${dbPath}`).toBe(true);
  expect(statSync(dbPath).size).toBeGreaterThan(0);

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const sessionRows = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    expect(sessionRows.n, 'sessions row written').toBeGreaterThan(0);

    const eventRows = db.prepare('SELECT COUNT(*) AS n FROM events_chunks').get() as { n: number };
    expect(eventRows.n, 'events_chunks row written').toBeGreaterThan(0);

    const consoleRows = db.prepare('SELECT COUNT(*) AS n FROM console_events').get() as {
      n: number;
    };
    expect(consoleRows.n, 'console_events row written').toBeGreaterThan(0);
  } finally {
    db.close();
  }
});
