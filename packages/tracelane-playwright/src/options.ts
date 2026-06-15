// User-facing options for the Playwright reporter + fixture, and resolveOptions
// which normalizes them into the fully-resolved shape the session consumes.
//
// The option names mirror @tracelane/wdio (mode, outDir) and the env contract
// mirrors @tracelane/core (TRACELANE_MODE) plus TRACELANE_OUT_DIR. Capture
// surface is rrweb + console (always on) + network (captureNetwork, default on;
// in-page on all browsers, plus Chromium CDP enrichment — see playwright-session.ts).

import type { Mode } from '@tracelane/core';

/** The default output directory for reports (matches @tracelane/wdio). */
export const DEFAULT_OUT_DIR = './tracelane-reports';

type EnvLike = Record<string, string | undefined>;

/** User-supplied options (all optional; passed to the reporter and/or fixture). */
export interface TraceLaneOptions {
  /**
   * Capture mode (ADR-0005). `'failed'` (default) writes a report only on test
   * failure; `'all'` writes one for every test. `TRACELANE_MODE` overrides this.
   */
  mode?: Mode;
  /** Directory to write reports into. Default `'./tracelane-reports'`. `TRACELANE_OUT_DIR` overrides. */
  outDir?: string;
  /**
   * Capture network requests. Default `true`.
   *
   * Captured in-page by the framework-agnostic `rrweb/network@1` plugin, which
   * works on ALL browsers (Chromium/Firefox/WebKit) with no CDP. On Chromium,
   * CDP additionally enriches the report with authoritative status for failed
   * responses and true no-response failures (the report merges the two). Set
   * `false` to disable network capture entirely (both channels).
   *
   * The reporter bridges this option to `TRACELANE_CAPTURE_NETWORK` at startup
   * (only when that env var is not already set), so the fixture honors it. An
   * explicit `TRACELANE_CAPTURE_NETWORK` env var always wins over this option.
   * To force-disable CDP capture regardless of reporter config, set:
   * `TRACELANE_CAPTURE_NETWORK=false` before running Playwright.
   */
  captureNetwork?: boolean;
}

/** Fully-resolved options — every field present. */
export interface ResolvedOptions {
  mode: Mode;
  outDir: string;
  captureNetwork: boolean;
}

function isMode(value: string | undefined): value is Mode {
  return value === 'failed' || value === 'all';
}

/** Read `process.env` defensively (no hard `@types/node` dependency). */
function defaultEnv(): EnvLike {
  return (globalThis as { process?: { env?: EnvLike } }).process?.env ?? {};
}

/**
 * Resolve user options into a fully-resolved shape, applying defaults and the
 * `TRACELANE_MODE` / `TRACELANE_OUT_DIR` / `TRACELANE_CAPTURE_NETWORK` env
 * overrides (env wins over config, matching @tracelane/core's resolveMode). An
 * invalid `TRACELANE_MODE` is ignored. `env` is injectable for testing.
 *
 * `TRACELANE_CAPTURE_NETWORK=false` (case-insensitive) disables network capture
 * in the fixture (both the in-page rrweb/network plugin and the Chromium CDP
 * enrichment). The reporter bridges the `captureNetwork` option to this env var
 * at startup (when not already set), so the fixture receives it. An explicit
 * env var always wins over the reporter option.
 */
export function resolveOptions(
  opts: TraceLaneOptions = {},
  env: EnvLike = defaultEnv(),
): ResolvedOptions {
  const mode: Mode = isMode(env.TRACELANE_MODE) ? env.TRACELANE_MODE : (opts.mode ?? 'failed');
  const outDir = env.TRACELANE_OUT_DIR ?? opts.outDir ?? DEFAULT_OUT_DIR;
  const envCaptureNetwork = env.TRACELANE_CAPTURE_NETWORK;
  const captureNetwork =
    envCaptureNetwork !== undefined
      ? envCaptureNetwork.toLowerCase() !== 'false'
      : (opts.captureNetwork ?? true);
  return { mode, outDir, captureNetwork };
}
