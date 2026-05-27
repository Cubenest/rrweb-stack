/**
 * Console-plugin event extraction for the ISOLATED relay (pure, unit-tested).
 *
 * An rrweb console-plugin event (`type: 6 /* EventType.Plugin *​/`, plugin
 * `rrweb/console@1`) embeds the page's RAW `console.*` args at
 * `data.payload.payload: string[]` — exactly the place an app might log a token
 * or password. Two responsibilities live here:
 *
 *   - `extractConsoleEvent`: pull those args out and MASK them, producing the
 *     `RelayConsoleEvent` the SW forwards via `console.append`.
 *   - `isConsolePluginEvent`: the routing predicate the relay uses to ensure a
 *     console event goes ONLY through the masked path and is NOT also added to
 *     the raw rrweb batch (which ships verbatim) — review issue 1.
 *
 * Both are defensive about the payload shape: it arrives over `postMessage`
 * from the page's MAIN-world realm and is therefore untrusted.
 */

import type { RelayConsoleEvent } from '../messaging/protocol.js';
import { maskConsoleArgs } from './mask.js';

/** EventType.Plugin (rrweb). */
const EVENT_TYPE_PLUGIN = 6;
/** The console plugin's stable name in the rrweb event stream. */
const CONSOLE_PLUGIN_NAME = 'rrweb/console@1';

/**
 * Whether an rrweb event (as received over postMessage) is a console-plugin
 * event. The relay uses this to keep raw console args OUT of the verbatim
 * rrweb batch — they only travel masked, via {@link extractConsoleEvent}.
 */
export function isConsolePluginEvent(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const ev = payload as { type?: unknown; data?: { plugin?: unknown } };
  return ev.type === EVENT_TYPE_PLUGIN && ev.data?.plugin === CONSOLE_PLUGIN_NAME;
}

/**
 * Extract + MASK a console-plugin event, or return `null` for any other event
 * shape. The returned `args` are already run through the PII regex bank
 * ({@link maskConsoleArgs}); the raw args never leave this function.
 */
export function extractConsoleEvent(payload: unknown): RelayConsoleEvent | null {
  if (!isConsolePluginEvent(payload)) return null;
  const ev = payload as {
    timestamp?: unknown;
    data?: { payload?: { level?: unknown; payload?: unknown } };
  };
  const inner = ev.data?.payload;
  if (!inner) return null;
  const level = typeof inner.level === 'string' ? inner.level : 'log';
  const rawArgs = Array.isArray(inner.payload) ? inner.payload.map((a) => String(a)) : [];
  return {
    ts: typeof ev.timestamp === 'number' ? ev.timestamp : Date.now(),
    level,
    args: maskConsoleArgs(rawArgs),
  };
}
