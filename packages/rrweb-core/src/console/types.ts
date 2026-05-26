// Console capture types — Task 1.8.
//
// Public-facing shapes for the console capture buffer. The buffer normalizes
// the upstream `@rrweb/rrweb-plugin-console-record` `LogData` payload
// (`{ level, trace: string[], payload: string[] }`) into a stable
// `ConsoleEvent` with our own field names so downstream consumers (P1 report
// renderer, P2 MCP tool surface) don't bind to vendor field names that
// happen to collide (the plugin uses `payload` for the args array, which
// makes call sites like `event.data.payload.payload` impossible to read).

import type { LogLevel as PluginLogLevel } from '@rrweb/rrweb-plugin-console-record';

/**
 * The full set of console levels the upstream plugin can emit. The plugin's
 * default level list is much broader than the typical `log/info/warn/error`
 * quartet — it patches every `console.*` shape it knows about, including
 * `assert`, `count`, `dir`, `group`, `table`, `time*`, and `trace`. We
 * re-export the union here so consumers can declare-and-pass without
 * importing from the vendor package directly.
 *
 * Default level list (from the plugin source) is:
 * `assert, clear, count, countReset, debug, dir, dirxml, error, group,
 * groupCollapsed, groupEnd, info, log, table, time, timeEnd, timeLog,
 * trace, warn`.
 */
export type ConsoleLevel = PluginLogLevel;

/**
 * The narrower set of "log-shaped" console levels that carry meaningful
 * `args` payloads in practice — these are the ones most P1/P2 surfaces
 * render. Other levels (`group`, `time*`, `count*`, etc.) still flow
 * through the buffer untouched, but consumers that only want
 * triage-relevant entries typically filter to this subset.
 */
export type BasicConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace';

/**
 * A captured console event with the shape downstream consumers see after the
 * rrweb plugin emits and our buffer normalizes it. Mirrors the plugin's
 * `LogData` shape (`{ level, trace, payload: string[] }`) but renames the
 * args array (`payload` → `args`) so consumers don't have to disambiguate
 * the two `payload` fields in the raw rrweb plugin event.
 *
 * Field-by-field mapping vs the plugin's `LogData`:
 *   - `level`  ← `LogData.level`           (verbatim)
 *   - `args`   ← `LogData.payload`         (renamed for clarity)
 *   - `trace`  ← `LogData.trace`           (verbatim; only populated when
 *                                            non-empty — see buffer.ts)
 *   - `ts`     ← the surrounding rrweb event's `timestamp`
 */
export interface ConsoleEvent {
  /** Wall-clock time (ms since epoch) the rrweb engine stamped the event. */
  ts: number;
  /**
   * Console level the plugin observed. See `ConsoleLevel` for the full
   * vocabulary; most consumers will filter to `BasicConsoleLevel`.
   */
  level: ConsoleLevel;
  /**
   * Stringified arguments. Already truncated by the plugin per
   * `stringifyOptions.stringLengthLimit` / `numOfKeysLimit` /
   * `depthOfLimit` — we don't re-serialize.
   */
  args: string[];
  /**
   * Stack trace lines if the plugin captured them. The plugin populates
   * this for every patched call (it calls `ErrorStackParser.parse(new
   * Error())` and drops the first frame), but the buffer only retains
   * it when non-empty so consumers can use `trace !== undefined` as a
   * meaningful signal.
   */
  trace?: string[];
}
