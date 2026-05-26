// Shadow DOM adapter types — Task 1.5.
//
// `ShadowRootInfo` is the single value the walker emits per host element.
// It captures both the resolved root (when reachable) and enough provenance
// for the consumer to understand WHY a given root is or is not in hand:
//
//   - `mode`   — what the host's shadow root was declared as. `'unknown'`
//                is reserved for the heuristic "probably closed shadow,
//                couldn't confirm" path so we don't lie and say `'closed'`
//                when we never asked attachShadow at all.
//   - `source` — how we resolved the root. `'attachShadow'` is the plain
//                `el.shadowRoot` reflection (open roots). `'chrome.dom'`
//                is the ISOLATED-world `chrome.dom.openOrClosedShadowRoot`
//                helper that callers can inject. `'unreachable'` means we
//                detected a host but couldn't reach into it (closed shadow
//                in MAIN world, or the custom-element heuristic).
//
// `host` always points at the element on the document side. `root` is null
// only on the `'unreachable'` path — the consumer should not treat null as
// a value-tagged optional but as the literal "we cannot see inside this."
//
// See P2 PRD §A.3 for the closed-shadow-root MAIN-world limitation this
// shape documents.

/**
 * A single shadow host detected by `traverseShadowRoots`.
 */
export interface ShadowRootInfo {
  /** The host element on the light-DOM side of the boundary. */
  host: Element;
  /**
   * The shadow root if we could reach it, otherwise `null`. `null` is
   * always paired with `source: 'unreachable'`.
   */
  root: ShadowRoot | null;
  /**
   * What the host's shadow root is declared as.
   *
   * - `'open'`    — resolved via `el.shadowRoot`.
   * - `'closed'`  — confirmed closed (resolved via the injected helper, or
   *                 attached as closed via `attachShadow({mode:'closed'})`
   *                 and we noticed via the helper).
   * - `'unknown'` — heuristic detection without confirmation (e.g.
   *                 custom-element heuristic).
   */
  mode: 'open' | 'closed' | 'unknown';
  /**
   * How the root was resolved.
   *
   * - `'attachShadow'` — `el.shadowRoot` reflection (open roots only).
   * - `'chrome.dom'`   — caller-injected `openOrClosedShadowRoot` helper,
   *                      typically backed by `chrome.dom.openOrClosedShadowRoot`
   *                      in an ISOLATED-world content script.
   * - `'unreachable'`  — host detected but root not accessible from this
   *                      execution context. Browser encapsulation is being
   *                      respected; this is the intended outcome in MAIN
   *                      world for closed shadow roots.
   */
  source: 'attachShadow' | 'chrome.dom' | 'unreachable';
  /**
   * Nesting depth. The first generation of hosts found directly under the
   * traversal `root` is `0`; hosts inside those hosts' shadow roots are
   * `1`, and so on.
   */
  depth: number;
}
