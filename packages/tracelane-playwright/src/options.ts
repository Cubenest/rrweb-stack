// User-facing options for the Playwright reporter + fixture, and resolveOptions
// which normalizes them into the fully-resolved shape the session consumes.
//
// The option names mirror @tracelane/wdio (mode, outDir) and the env contract
// mirrors @tracelane/core (TRACELANE_MODE) plus TRACELANE_OUT_DIR. MVP capture
// surface is rrweb + console (always on) + failed-network (captureNetwork,
// default on; Chromium-only at runtime — see playwright-session.ts).

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
   * Capture failed network requests via CDP (Chromium-only). Default `true`.
   * Routed into the report's network panel through the rrweb console plugin.
   *
   * **Cross-process note**: reporter constructor options are not propagated to
   * the fixture (they run in separate Playwright worker processes). Setting
   * `captureNetwork: false` on the reporter has no effect on the fixture's CDP
   * capture. To disable CDP capture in the fixture, set the env var:
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
 * `TRACELANE_CAPTURE_NETWORK=false` (case-insensitive) disables CDP network
 * capture in the fixture. This is the cross-process mechanism for the
 * `captureNetwork` option — reporter constructor options are not propagated to
 * the fixture because they run in different Playwright worker processes.
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
