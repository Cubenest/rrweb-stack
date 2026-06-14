// Shared E2E harness for the peek extension Playwright specs.
//
// Factored out of smoke.spec.ts (Task 9) so the shield spec can reuse the
// persistent-context launch + service-worker resolution, and add a *real*
// native-host connection that flips the SW's `hostState` to 'connected'.
//
// Why a real native host (not the smoke's detached child): the control shield
// only RAISEs when `hostState === 'connected' && nativePort !== null`, and that
// state is owned by the SW's `chrome.runtime.connectNative(NATIVE_HOST_ID)`.
// To make `connectNative` succeed inside the launched Chromium we must install
// a native-messaging host manifest at Chromium's well-known directory whose
// `allowed_origins` lists the *loaded* extension's id. The unpacked extension
// id is non-deterministic (no pinned manifest `key`), so we resolve it at
// runtime from the SW URL, write the manifest, then reload the SW so its
// top-level `connectNative()` runs with the manifest present.

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type BrowserContext, type Worker, chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

/** Built unpacked extension (WXT output). */
export const extensionDir = resolve(here, '..', '.output', 'chrome-mv3');

/** Built peek-mcp entry — the binary the native host manifest points a wrapper at. */
export const peekMcpDist = resolve(here, '..', '..', 'peek-mcp', 'dist', 'index.js');

/** Reverse-DNS native-host id (mirrors src/constants.ts NATIVE_HOST_ID). */
const NATIVE_HOST_NAME = 'com.cubenest.peek';

/**
 * Resolve the GLOBAL native-messaging host directory the launched browser reads
 * (not per-user-data-dir). Playwright's `channel: 'chromium'` is actually the
 * "Google Chrome for Testing" build, whose product directory is
 * `Google/Chrome for Testing` (NOT `Chromium`) — the manifest must land there
 * or `connectNative` reports "Specified native messaging host not found." and
 * the port disconnect-storms. (Windows native messaging goes through the
 * registry and is out of scope for this harness.)
 */
function chromiumNativeHostDir(): string {
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(
      home,
      'Library',
      'Application Support',
      'Google',
      'Chrome for Testing',
      'NativeMessagingHosts',
    );
  }
  // linux: Chrome for Testing registers under ~/.config/google-chrome-for-testing
  return join(home, '.config', 'google-chrome-for-testing', 'NativeMessagingHosts');
}

export interface LaunchedExtension {
  context: BrowserContext;
  extensionDir: string;
  userDataDir: string;
}

/**
 * Launch a persistent Chromium context with the unpacked peek extension loaded.
 * Mirrors smoke.spec.ts's launch flags exactly (the full chromium build + the
 * modern `--headless=new` mode is required to load MV3 extensions; the default
 * headless_shell build silently drops extensions — Playwright #35395).
 */
async function launchInProfile(userDataDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
}

export async function launchExtension(): Promise<LaunchedExtension> {
  if (!existsSync(extensionDir)) {
    throw new Error(
      `peek e2e: extension not built — run \`pnpm --filter @peekdev/extension build\` first. (looked at ${extensionDir})`,
    );
  }
  const userDataDir = mkdtempSync(join(tmpdir(), 'peek-e2e-userdata-'));
  const context = await launchInProfile(userDataDir);
  return { context, extensionDir, userDataDir };
}

/**
 * Resolve the extension's MV3 service worker, polling briefly (the SW may
 * register a beat after launchPersistentContext returns). Throws if none
 * appears, so callers get a clear failure rather than an undefined worker.
 */
export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  let workers = context.serviceWorkers();
  for (let i = 0; i < 40 && workers.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 250));
    workers = context.serviceWorkers();
  }
  const sw = workers[0];
  if (!sw) throw new Error('peek e2e: extension service worker never registered');
  return sw;
}

/** Parse the unpacked extension id from a `chrome-extension://<id>/...` SW url. */
export function extensionIdFromWorker(sw: Worker): string {
  const m = sw.url().match(/^chrome-extension:\/\/([a-p]+)\//);
  if (!m?.[1]) throw new Error(`peek e2e: could not parse extension id from SW url '${sw.url()}'`);
  return m[1];
}

/** Handle for the wired-up native host; `stop()` undoes the global manifest write. */
export interface NativeHostHandle {
  /**
   * The live context with a (best-effort) connected host. NOTE: this is a FRESH
   * context — `spawnNativeHost` relaunches after writing the manifest (see
   * below), so the caller MUST use this context (and re-resolve pages/SW from
   * it), not the one passed in.
   */
  context: BrowserContext;
  /** PEEK_HOME the spawned host writes its SQLite under. */
  peekHome: string;
  /**
   * Whether the SW reached a STABLE `hostState === 'connected'` (i.e. the
   * launched browser's native messaging actually works here). `false` means the
   * environment cannot connect a native host — `connectNative` either reports
   * "host not found" or disconnect-storms back to 'reconnecting' (common in
   * headless CI sandboxes). Callers must treat `connected === false` as "native
   * messaging unavailable" and skip the shield round-trip rather than failing
   * red (matches the plan's option-(b) fallback "until the harness wires a
   * host"). `stop()` is still safe to call.
   */
  connected: boolean;
  /** Restore the global NativeMessagingHosts dir to its pre-test state + cleanup. */
  stop(): Promise<void>;
}

/**
 * Poll the SW's `hostState` (via an extension-page sender) until it reports a
 * STABLE 'connected' — i.e. it reads 'connected' on several consecutive probes
 * spread over `settleMs`. A single 'connected' read is NOT enough: when native
 * messaging is unavailable the SW's `connectNative()` sets `hostState =
 * 'connected'` synchronously on every retry attempt, BEFORE the immediate
 * `onDisconnect` knocks it back to 'reconnecting', so a naive poll can latch a
 * transient 'connected' between storm cycles. Requiring the state to HOLD
 * distinguishes a real connection from the disconnect-storm. Returns `true` if
 * a stable connection was observed within `timeoutMs`, else `false` (never
 * throws — the caller decides whether absence is fatal).
 */
async function waitForStableConnection(
  probe: () => Promise<string>,
  { timeoutMs = 30_000, settleMs = 2_000, intervalMs = 500 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probe()) === 'connected') {
      // Saw 'connected' once — verify it HOLDS across the settle window.
      const settleDeadline = Date.now() + settleMs;
      let stable = true;
      while (Date.now() < settleDeadline) {
        await new Promise((r) => setTimeout(r, intervalMs));
        if ((await probe()) !== 'connected') {
          stable = false;
          break;
        }
      }
      if (stable) return true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Wire a REAL native-messaging host so the SW's `hostState` flips to
 * 'connected' (the precondition for the shield to RAISE), then return a fresh
 * context booted with that host present.
 *
 * Why relaunch: Chrome/Chrome-for-Testing scans the NativeMessagingHosts
 * directory and CACHES the result the first time `connectNative()` runs. The
 * extension's SW fires `connectNative()` at startup — before any test code can
 * write the manifest — so it caches a "host not found" and then disconnect-
 * storms forever within that browser session, regardless of a manifest written
 * later. The fix is to write the manifest BEFORE the browser that will use it
 * starts. The unpacked extension id is stable for a fixed `--load-extension`
 * path (Chrome derives it from the absolute path), so we:
 *   1. Resolve the stable id from the just-launched SW.
 *   2. Write an exec wrapper that runs the built peek-mcp under a temp PEEK_HOME
 *      (the host auto-detects native-host mode from the chrome-extension://
 *      origin Chrome passes as argv — no flag needed).
 *   3. Write the native-host manifest (allow-listing that id) into Chrome for
 *      Testing's global NativeMessagingHosts dir, backing up any pre-existing
 *      file so `stop()` restores it.
 *   4. Close the passed-in context and relaunch the SAME persistent profile +
 *      extension path (so the id is unchanged and the manifest matches), now
 *      with the host on disk at startup.
 *   5. Poll the SW's host state (from an extension page, which also keeps the
 *      MV3 worker warm) until it reports 'connected'.
 */
export async function spawnNativeHost(launched: LaunchedExtension): Promise<NativeHostHandle> {
  if (!existsSync(peekMcpDist)) {
    throw new Error(
      `peek e2e: peek-mcp not built — run \`pnpm --filter @peekdev/mcp build\` first. (looked at ${peekMcpDist})`,
    );
  }

  const sw = await getServiceWorker(launched.context);
  const extId = extensionIdFromWorker(sw);
  const peekHome = mkdtempSync(join(tmpdir(), 'peek-e2e-home-'));
  const wrapperDir = mkdtempSync(join(tmpdir(), 'peek-e2e-host-'));
  const wrapperPath = join(wrapperDir, 'peek-mcp-host.sh');

  // The wrapper pins PEEK_HOME so the host writes its SQLite into our temp dir,
  // then execs the built entry, forwarding the origin argv Chromium passes.
  writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexport PEEK_HOME=${JSON.stringify(peekHome)}\nexec ${JSON.stringify(
      process.execPath,
    )} ${JSON.stringify(peekMcpDist)} "$@"\n`,
    'utf8',
  );
  chmodSync(wrapperPath, 0o755);

  const manifest = {
    name: NATIVE_HOST_NAME,
    description: 'peek e2e native host',
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extId}/`],
  };

  const hostDir = chromiumNativeHostDir();
  mkdirSync(hostDir, { recursive: true });
  const manifestPath = join(hostDir, `${NATIVE_HOST_NAME}.json`);
  const backupPath = `${manifestPath}.peek-e2e-bak`;
  const hadPrevious = existsSync(manifestPath);
  if (hadPrevious) copyFileSync(manifestPath, backupPath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // Relaunch the SAME profile + extension path so the id is unchanged and the
  // browser now scans the manifest at startup (Chrome caches the host lookup on
  // first connectNative, so the manifest MUST predate the browser that uses it).
  await launched.context.close();
  const context = await launchInProfile(launched.userDataDir);

  // Probe the SW's host state from an EXTENSION page (sidepanel.html), not from
  // inside the SW itself: Chrome does not loop a `chrome.runtime.sendMessage`
  // back to the sending SW, so an in-SW probe always sees no receiver. An
  // extension page is a real sender (sender.id === runtime.id, which the SW's
  // router requires).
  //
  // The page also installs a 1s self-ping that stays running for the lifetime
  // of the handle: it keeps the MV3 worker awake so the host stays bound to ONE
  // warm SW instance — the connect state and the storage-change fan-out that
  // RAISEs the shield must live in the same worker instance, else a wake resets
  // `hostState` to 'disconnected' and the shield refuses to raise.
  const keepAlive = await context.newPage();
  await keepAlive.goto(`chrome-extension://${extId}/sidepanel.html`);
  await keepAlive.evaluate(() => {
    (globalThis as { __peekKeepAlive?: number }).__peekKeepAlive = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'getNativeHostState' }, () => {
        void chrome.runtime.lastError;
      });
    }, 1000) as unknown as number;
  });

  // Probe the SW's `hostState` from the extension page. background.ts answers
  // { type: 'getNativeHostState' } with the current NativeHostState in `state`.
  const probeHostState = (): Promise<string> =>
    keepAlive.evaluate(
      () =>
        new Promise<string>((res) => {
          chrome.runtime.sendMessage({ type: 'getNativeHostState' }, (r) => {
            void chrome.runtime.lastError; // swallow no-receiver during a wake
            res((r as { state?: string } | undefined)?.state ?? 'unknown');
          });
        }),
    );

  // Best-effort: wait for a STABLE 'connected'. If native messaging is
  // unavailable here (sandbox), this returns false instead of throwing so the
  // caller can skip the shield round-trip rather than fail red.
  const connected = await waitForStableConnection(probeHostState);

  return {
    context,
    peekHome,
    connected,
    async stop(): Promise<void> {
      try {
        await keepAlive.close();
      } catch {
        // page may already be closed with the context
      }
      try {
        if (hadPrevious) {
          copyFileSync(backupPath, manifestPath);
          unlinkSync(backupPath);
        } else if (existsSync(manifestPath)) {
          unlinkSync(manifestPath);
        }
      } catch {
        // best-effort restore
      }
      try {
        rmSync(wrapperDir, { recursive: true, force: true });
        rmSync(peekHome, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}
