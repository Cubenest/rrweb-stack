/**
 * Capture mode (ADR-0005).
 *
 * - `'failed'` (default): events buffer in memory during the test; on pass the
 *   buffer is discarded, on failure a report is built.
 * - `'all'`: a report is built regardless of outcome (visual-regression
 *   workflows), available behind `TRACELANE_MODE=all`.
 */
export type Mode = 'failed' | 'all';

/** The default capture mode (ADR-0005). */
export const DEFAULT_MODE: Mode = 'failed';

function isMode(value: string | undefined): value is Mode {
  return value === 'failed' || value === 'all';
}

/**
 * Read `TRACELANE_MODE` from the environment without a hard dependency on
 * `@types/node` (this package stays framework- and platform-light). Resolves
 * `process.env` defensively so it's a no-op in a browser-like context.
 */
function readModeEnv(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.TRACELANE_MODE;
}

/**
 * Resolve the effective mode. The `TRACELANE_MODE` env var, when set to a valid
 * value, overrides the config; an invalid env value is ignored. Falls back to
 * the config mode, then {@link DEFAULT_MODE}.
 */
export function resolveMode(configMode?: Mode): Mode {
  const fromEnv = readModeEnv();
  if (isMode(fromEnv)) return fromEnv;
  return configMode ?? DEFAULT_MODE;
}
