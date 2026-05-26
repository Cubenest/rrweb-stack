// Shadow DOM walker — Task 1.5.
//
// Walks the DOM from a given root and reports every shadow host it finds.
// Pure enumeration — does NOT serialize shadow contents, does NOT subscribe
// to mutations. rrweb does that elsewhere; we just answer "where are the
// hosts and what can we see through them?".
//
// Why this exists despite the PostHog fork already handling shadow hosts:
// ADR-0002 calls it "a thin wrapper around the PostHog fork's shadow-host
// handling that closes known gaps in custom-element traversal and documents
// the gaps that remain." The fork's logic is internal; we re-implement at
// this layer so consumers have a stable surface (`ShadowRootInfo[]`) and a
// single seam to inject the ISOLATED-world `chrome.dom.openOrClosedShadowRoot`
// helper from a content script.
//
// Closed shadow roots in MAIN world: the browser intentionally hides
// `el.shadowRoot` for `attachShadow({mode:'closed'})`. We respect that —
// no reflect-hacking, no Proxy tricks. Such hosts land on the
// `'unreachable'` path and (if the caller wired one) fire
// `options.onUnreachable(el)` so the consumer can log/breadcrumb.
//
// We do NOT traverse into `iframe.contentDocument`. In real usage iframes
// are very often cross-origin, where `contentDocument` access throws. Even
// when same-origin, iframes have independent recording semantics in rrweb
// and should be handled by the recorder's `recordCrossOriginIframes`
// pathway, not by us.

import type { ShadowRootInfo } from './types';

/** Default `maxDepth` — pathological apps have been observed nesting ~8 deep. */
const DEFAULT_MAX_DEPTH = 16;

export interface TraverseShadowRootsOptions {
  /**
   * Maximum shadow-root nesting depth to recurse into. Defaults to 16.
   * Hosts at exactly `maxDepth - 1` are recorded; their shadow contents
   * are not recursed into.
   */
  maxDepth?: number;
  /**
   * Called once for every host we detected but could not reach into. Fires
   * for both the closed-shadow-root MAIN-world case and the custom-element
   * heuristic. Throws are swallowed so a noisy consumer can't break the
   * walk.
   */
  onUnreachable?: (host: Element) => void;
  /**
   * When `true`, the walker will call `openOrClosedShadowRoot` (if
   * provided) to try to reach closed shadow roots. Defaults to `false` —
   * MAIN-world callers should leave this off; ISOLATED-world content
   * scripts that have wired `chrome.dom.openOrClosedShadowRoot` should
   * pass `true`.
   */
  includeClosed?: boolean;
  /**
   * Caller-injected helper, intended to be
   * `chrome.dom.openOrClosedShadowRoot` in an ISOLATED-world content
   * script. Returning `null`/`undefined` is interpreted as "no shadow
   * root on this element"; returning a `ShadowRoot` is interpreted as
   * "this element has a (probably closed) shadow root, here it is."
   *
   * Only consulted when `includeClosed === true`.
   */
  openOrClosedShadowRoot?: (el: Element) => ShadowRoot | null | undefined;
}

/**
 * Walk the DOM from `root` and return every shadow host found.
 *
 * Open shadow roots are resolved via `el.shadowRoot`. Closed shadow roots
 * are only reachable if the caller injects `openOrClosedShadowRoot` AND
 * passes `includeClosed: true` — typically a content script forwarding
 * `chrome.dom.openOrClosedShadowRoot` from an ISOLATED world. In MAIN
 * world, closed shadow hosts are recorded as `'unreachable'`; browser
 * encapsulation is respected (we do NOT reflect-hack into closed shadows).
 *
 * Does not descend into iframes — `iframe.contentDocument` is usually
 * cross-origin and rrweb has its own iframe recording pathway.
 *
 * @param root    Document, fragment, or element to walk.
 * @param options See {@link TraverseShadowRootsOptions}.
 * @returns A flat array of `ShadowRootInfo`, ordered by traversal (DFS
 *          pre-order). Each host appears at most once.
 */
export function traverseShadowRoots(
  root: Document | DocumentFragment | Element,
  options: TraverseShadowRootsOptions = {},
): ShadowRootInfo[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const includeClosed = options.includeClosed ?? false;
  const openOrClosed = options.openOrClosedShadowRoot;
  const onUnreachable = options.onUnreachable;

  const seen = new Set<Element>();
  const results: ShadowRootInfo[] = [];

  // Avoid recursion to keep stack depth bounded for pathological nesting.
  // The work list carries (subtree-root, depth) — depth is the depth the
  // hosts inside that subtree-root will land at.
  const work: Array<{ subtree: Document | DocumentFragment | Element; depth: number }> = [
    { subtree: root, depth: 0 },
  ];

  while (work.length > 0) {
    const item = work.shift();
    if (!item) break;
    const { subtree, depth } = item;
    if (depth >= maxDepth) continue;

    for (const el of iterDescendantElements(subtree)) {
      if (seen.has(el)) continue;

      const info = resolveHost(el, depth, includeClosed, openOrClosed);
      if (!info) continue;

      seen.add(el);
      results.push(info);

      if (info.source === 'unreachable') {
        if (onUnreachable) {
          try {
            onUnreachable(el);
          } catch {
            // Consumer callback errors must not abort the walk.
          }
        }
      } else if (info.root) {
        // Queue the shadow root for traversal; nested hosts land at depth+1.
        work.push({ subtree: info.root, depth: depth + 1 });
      }
    }
  }

  return results;
}

/**
 * Resolve a single element into a `ShadowRootInfo`, or `null` if it isn't a
 * shadow host. Implements the per-host resolution algorithm from
 * IMPLEMENTATION_PLAN.md Task 1.5.
 */
function resolveHost(
  el: Element,
  depth: number,
  includeClosed: boolean,
  openOrClosed: ((el: Element) => ShadowRoot | null | undefined) | undefined,
): ShadowRootInfo | null {
  // Step 1: open shadow root via the standard reflection.
  const openRoot = el.shadowRoot;
  if (openRoot) {
    return {
      host: el,
      root: openRoot,
      mode: 'open',
      source: 'attachShadow',
      depth,
    };
  }

  // Step 2: caller-provided helper (chrome.dom.openOrClosedShadowRoot).
  if (includeClosed && openOrClosed) {
    let injectedRoot: ShadowRoot | null | undefined;
    try {
      injectedRoot = openOrClosed(el);
    } catch {
      // The helper may throw on detached nodes etc; treat as "no root".
      injectedRoot = null;
    }
    if (injectedRoot) {
      return {
        host: el,
        root: injectedRoot,
        mode: 'closed',
        source: 'chrome.dom',
        depth,
      };
    }
  }

  // Step 3: best-effort heuristic — a custom element (tag name contains a
  // hyphen) with no light-DOM children is *probably* a closed shadow host.
  // This is intentionally permissive; the consumer's `onUnreachable`
  // callback exists precisely so callers can downgrade these reports if
  // they have richer information. See ADR-0002 — "closes known gaps in
  // custom-element traversal and documents the gaps that remain."
  if (isLikelyClosedCustomElementHost(el)) {
    return {
      host: el,
      root: null,
      mode: 'unknown',
      source: 'unreachable',
      depth,
    };
  }

  // Step 4: not a shadow host.
  return null;
}

/**
 * Cheap heuristic: an element is "probably a closed shadow host" if its
 * tag name contains a hyphen (Custom Elements v1 requirement) and it has
 * no child nodes in the light DOM. False positives are intentional — the
 * consumer's `onUnreachable` is the escape hatch.
 */
function isLikelyClosedCustomElementHost(el: Element): boolean {
  const tag = el.tagName;
  if (!tag) return false;
  // Built-ins like `<div>`/`<span>` have no hyphen. Custom elements must.
  if (!tag.includes('-')) return false;
  // If we can see light DOM children, it's almost certainly not a closed
  // shadow host (or, if it is, we'd still walk into the light tree below
  // anyway — no information is lost by skipping it here).
  if (el.childNodes.length > 0) return false;
  return true;
}

/**
 * Iterate the element descendants of a subtree root (the root itself is
 * NOT yielded — the caller has already considered it on the previous
 * iteration if it was a host).
 *
 * Uses a manual stack rather than `TreeWalker` to keep semantics
 * predictable across jsdom/Chromium/WebKit, all of which have had
 * shadow-related TreeWalker quirks.
 */
function* iterDescendantElements(
  subtree: Document | DocumentFragment | Element,
): Iterable<Element> {
  // For a Document, start at documentElement (the <html>); for fragments
  // and elements, start at the first child.
  const starts: Element[] = [];
  if (isDocument(subtree)) {
    if (subtree.documentElement) starts.push(subtree.documentElement);
  } else {
    for (const child of Array.from(subtree.children)) {
      starts.push(child);
    }
  }

  const stack: Element[] = [...starts].reverse();
  while (stack.length > 0) {
    const el = stack.pop();
    if (!el) break;
    yield el;
    // Push children in reverse so we visit them left-to-right (pre-order).
    const children = el.children;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push(child);
    }
  }
}

function isDocument(x: Document | DocumentFragment | Element): x is Document {
  // Document.nodeType === 9; DocumentFragment.nodeType === 11; Element.nodeType === 1.
  return x.nodeType === 9;
}
