// User-facing options for the WDIO Service / hook factory (P1 PRD §M.1).

import type { NetworkRecordOptions } from '@cubenest/rrweb-core';
import type { ConsolePluginOptions, Mode } from '@tracelane/core';

/** Which capture channels are enabled (P1 PRD §M.1). */
export interface CaptureOptions {
  /** Record the rrweb session. Default true. */
  rrweb?: boolean;
  /**
   * Capture network requests. Default `true`.
   *
   * When enabled (default), the in-page rrweb network plugin
   * (`rrweb/network@1`) is registered alongside the recorder — captured
   * via fetch/XHR wrappers + PerformanceObserver, framework-agnostic,
   * no CDP required. The legacy CDP-based path (which routed failed
   * responses through the console timeline) is preserved as a fallback
   * but no longer the primary capture mechanism.
   *
   * Privacy defaults (inherited from `@cubenest/rrweb-core`): headers and
   * bodies are NOT captured unless opted in via {@link networkOptions}.
   */
  network?: boolean;
  /** Capture `console.*` via the rrweb console plugin. Default true. */
  console?: boolean;
  /**
   * Options forwarded to the in-page rrweb network plugin
   * (`getRecordNetworkPlugin`). The full surface from
   * `@cubenest/rrweb-core` is exposed: `recordHeaders`, `recordBody`,
   * `maskRequestFn`, `payloadHostDenyList`, etc. Defaults are the
   * plugin's defaults (privacy-first — headers + bodies off).
   *
   * Ignored when {@link network} is `false`.
   */
  networkOptions?: NetworkRecordOptions;
}

/** Options for {@link TraceLaneService} and {@link traceLaneHooks} (P1 PRD §M.1). */
export interface TraceLaneOptions {
  /**
   * Capture mode (ADR-0005). `'failed'` (default) writes a report only on test
   * failure; `'all'` writes one for every test. The `TRACELANE_MODE` env var
   * overrides this at report-decision time.
   */
  mode?: Mode;
  /** Directory to write reports into. Default `'./tracelane-reports'`. */
  outDir?: string;
  /** Reserved for the v1.1 Allure shim (ADR-0004). No-op in v1. Default false. */
  allure?: boolean;
  /** Per-channel capture toggles. */
  capture?: CaptureOptions;
  /** Reserved for the post-MVP visual-diff add-on (P1 PRD §H). No-op in v1. */
  visualDiff?: boolean;
  /** Node-side drain poll interval in ms (ADR-0006). Default 5000. */
  drainIntervalMs?: number;
  /** Re-injection cooldown guard in ms (ADR-0006). Default 250. */
  cooldownMs?: number;
  /** Options forwarded to the in-page rrweb console plugin. */
  consolePluginOptions?: ConsolePluginOptions;
}

/** The default output directory for reports. */
export const DEFAULT_OUT_DIR = './tracelane-reports';
