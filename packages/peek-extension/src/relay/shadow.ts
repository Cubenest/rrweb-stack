/**
 * Closed shadow root fallback (Task 3.21, P2 PRD §A.3).
 *
 * THE LIMITATION (§A.3): a `world: 'MAIN'` script — i.e. the rrweb recorder —
 * cannot see CLOSED shadow roots. `el.shadowRoot` returns null for
 * `attachShadow({ mode: 'closed' })`, by design, and the browser only exposes
 * `chrome.dom.openOrClosedShadowRoot(el)` in the ISOLATED world (W3C
 * webextensions Issue #612). So rrweb (MAIN) records open roots fine but misses
 * closed ones; the ISOLATED relay closes that gap by walking the DOM and
 * peeking through closed roots with `chrome.dom`. Safari has no equivalent
 * (w3c/webextensions Issue #647) — documented; on Safari this is a no-op.
 *
 * We reuse @cubenest/rrweb-core's `traverseShadowRoots` (built in Phase 1),
 * injecting `chrome.dom.openOrClosedShadowRoot` as its `openOrClosedShadowRoot`
 * helper with `includeClosed: true`. We report a COMPACT descriptor per host
 * (where it is, whether we reached it) — NOT the shadow subtree HTML, which
 * would be large and would need its own masking pass. This is best-effort
 * breadcrumbing of recording gaps, not a second recording channel.
 *
 * The DOM walk + `chrome.dom` call are browser side effects (E2E, Phase 3e).
 * The helper-wiring + host-path derivation here are pure and unit-tested.
 */

import { type ShadowRootInfo, traverseShadowRoots } from '@cubenest/rrweb-core';
import { RECORDING_FRAME_HOST_ATTR } from '../constants.js';
import type { ShadowReport } from '../messaging/protocol.js';

/** The ISOLATED-world `chrome.dom.openOrClosedShadowRoot` shape we inject. */
export type OpenOrClosedShadowRootFn = (el: Element) => ShadowRoot | null | undefined;

/**
 * Resolve `chrome.dom.openOrClosedShadowRoot` if present (Chrome/Edge ISOLATED
 * world), else `undefined` (Safari / MAIN world). Bound so it can be passed as
 * a plain function. The optional chaining is load-bearing: `chrome.dom` is
 * absent on Safari and on non-extension contexts.
 */
export function getOpenOrClosedShadowRoot(): OpenOrClosedShadowRootFn | undefined {
  const dom = (globalThis as { chrome?: { dom?: { openOrClosedShadowRoot?: unknown } } }).chrome
    ?.dom;
  const fn = dom?.openOrClosedShadowRoot;
  if (typeof fn !== 'function') return undefined;
  return (el: Element) => (fn as OpenOrClosedShadowRootFn).call(dom, el);
}

/**
 * A short, human-readable path to an element for correlation in reports
 * (`div#app > my-widget.foo`). Not a guaranteed-unique selector — it's a
 * breadcrumb, kept compact and free of attribute values that could carry PII.
 */
export function describeHost(el: Element): string {
  const segs: string[] = [];
  let node: Element | null = el;
  let hops = 0;
  while (node && hops < 5) {
    let seg = node.tagName ? node.tagName.toLowerCase() : 'node';
    if (node.id) seg += `#${node.id}`;
    else if (typeof node.className === 'string' && node.className.trim()) {
      const first = node.className.trim().split(/\s+/)[0];
      if (first) seg += `.${first}`;
    }
    segs.unshift(seg);
    node = node.parentElement;
    hops += 1;
  }
  return segs.join(' > ');
}

/** Map a `ShadowRootInfo` to the compact wire report. Pure. */
export function toShadowReport(info: ShadowRootInfo): ShadowReport {
  return {
    hostPath: describeHost(info.host),
    // We only emit reports for the interesting cases — see collectShadowReports.
    source: info.source === 'chrome.dom' ? 'chrome.dom' : 'unreachable',
    mode: info.mode,
  };
}

/**
 * Walk `root` for shadow hosts using the injected `chrome.dom` helper and
 * return reports for the ones that matter: closed roots we reached via
 * `chrome.dom`, and hosts we could not reach at all. Open roots are dropped
 * (rrweb already records those in MAIN world — no gap to flag).
 *
 * @param root  document/element to walk (the relay passes `document`).
 * @param openOrClosed  the injected `chrome.dom.openOrClosedShadowRoot`, or
 *   `undefined` on Safari/MAIN — in which case only `unreachable` hosts (the
 *   heuristic + closed-in-this-context) are reported.
 */
export function collectShadowReports(
  root: Document | DocumentFragment | Element,
  openOrClosed: OpenOrClosedShadowRootFn | undefined,
): ShadowReport[] {
  const infos = traverseShadowRoots(root, {
    includeClosed: openOrClosed !== undefined,
    ...(openOrClosed ? { openOrClosedShadowRoot: openOrClosed } : {}),
  });

  const reports: ShadowReport[] = [];
  for (const info of infos) {
    // Open roots resolved via el.shadowRoot are already covered by rrweb.
    if (info.source === 'attachShadow') continue;
    // Skip peek's own recording-indicator host: its closed shadow root is
    // intentional and is not an un-captured page gap to flag.
    if (info.host instanceof Element && info.host.hasAttribute(RECORDING_FRAME_HOST_ATTR)) {
      continue;
    }
    reports.push(toShadowReport(info));
  }
  return reports;
}
