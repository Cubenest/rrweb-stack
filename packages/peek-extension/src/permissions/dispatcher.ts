/**
 * MAIN-world DOM action dispatcher (Task 3.24, Phase 3e).
 *
 * SECURITY BOUNDARY — read before editing:
 *   • This code executes in the PAGE's MAIN world (injected via
 *     `chrome.scripting.executeScript({ world: 'MAIN', func: dispatchAction })`).
 *     It runs only AFTER the permission gate + side-panel confirm have allowed
 *     the action — but it must STILL treat every input as untrusted, because the
 *     `action` object originates from an AI client over MCP.
 *   • `action.selector` is treated as an opaque CSS selector and passed ONLY to
 *     `document.querySelector` / `querySelectorAll`. It is NEVER interpolated
 *     into HTML, evaluated, or used to construct code. There is no `eval`, no
 *     `innerHTML`, no `Function(...)`, no `setAttribute('on*')`.
 *   • `action.text` is assigned to `.value` as a plain string — never to
 *     `innerHTML`.
 *   • `navigate` validates the URL is http(s) before assigning `location` —
 *     this blocks `javascript:` / `data:` URL execution.
 *   • Every return value is a plain serializable object so it survives the
 *     `executeScript` result boundary.
 *
 * Because these functions are passed by reference to `executeScript`, they must
 * be SELF-CONTAINED: no module-scope imports, no closures over outer variables.
 * Keep them dependency-free. They are unit-tested here over jsdom.
 */

/**
 * The shape the dispatcher accepts. Intentionally permissive: the `action`
 * arrives from an AI client over MCP (untrusted), so we type it as "an object
 * with a string `type` plus arbitrary extra props" and narrow defensively per
 * branch. The protocol `Action` union is structurally assignable to this, so
 * background.ts can hand the SW's `action` straight through. Unrecognized
 * `type`s (back/forward/reload/screenshot/waitFor) hit the `default` → rejected.
 */
type DispatchableAction = { readonly type: string; readonly [k: string]: unknown };

/** The serializable result the SW forwards back to the host. */
export type DispatchResult = { ok: true; details?: unknown } | { ok: false; error: string };

/** Resolve a single element for an untrusted selector (+ optional nth match). */
function resolveElement(selector: string, nth?: number): Element | null {
  if (typeof selector !== 'string' || selector.length === 0) return null;
  try {
    if (typeof nth === 'number' && nth > 0) {
      const all = document.querySelectorAll(selector);
      return all.item(nth) ?? null;
    }
    return document.querySelector(selector);
  } catch {
    // An invalid selector string throws a SyntaxError — treat as not found.
    return null;
  }
}

/**
 * Execute one allowed action in the page. Self-contained + serializable result.
 * Returns `{ ok: false, error }` for any failure (missing element, bad URL,
 * unsupported action) — never throws.
 */
export function dispatchAction(action: DispatchableAction): DispatchResult {
  switch (action.type) {
    case 'click': {
      const selector = typeof action.selector === 'string' ? action.selector : '';
      const nth = typeof action.nth === 'number' ? action.nth : undefined;
      const el = resolveElement(selector, nth);
      if (!el) return { ok: false, error: `element not found: ${selector}` };
      (el as HTMLElement).click();
      return { ok: true };
    }
    case 'type': {
      const selector = typeof action.selector === 'string' ? action.selector : '';
      const el = resolveElement(selector);
      if (!el) return { ok: false, error: `element not found: ${selector}` };
      const text = typeof action.text === 'string' ? action.text : '';
      // Assign as a plain string value — NEVER innerHTML.
      (el as HTMLInputElement | HTMLTextAreaElement).value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    case 'navigate': {
      const url = typeof action.url === 'string' ? action.url : '';
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { ok: false, error: `invalid navigate URL: ${url}` };
      }
      // Block javascript:/data:/file: etc. — only http(s) top-frame nav.
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: `unsupported navigate URL scheme: ${parsed.protocol}` };
      }
      window.location.assign(parsed.href);
      return { ok: true };
    }
    case 'scroll': {
      const sel = action.selector;
      if (typeof sel === 'string' && sel.length > 0) {
        const el = resolveElement(sel);
        if (!el) return { ok: false, error: `element not found: ${sel}` };
        (el as HTMLElement).scrollIntoView();
        return { ok: true };
      }
      const x = typeof action.x === 'number' ? action.x : 0;
      const y = typeof action.y === 'number' ? action.y : 0;
      window.scrollTo(x, y);
      return { ok: true };
    }
    default:
      return { ok: false, error: `unsupported action: ${String(action.type)}` };
  }
}

/** The destructive-matcher signals resolved from a target element. */
export interface ResolvedTarget {
  text?: string | null;
  ariaLabel?: string | null;
  nearbyHeading?: string | null;
}

/**
 * Resolve the destructive-matcher signals for an untrusted selector. Returns an
 * empty object (no signals) for a missing/invalid/empty selector — NEVER throws
 * — so the SW gate runs even when resolution fails. Self-contained for
 * MAIN-world injection.
 *
 * Item B (nth): `nth` MUST be threaded through so the destructive matcher +
 * banner inspect the SAME element the dispatcher will click —
 * `querySelectorAll(selector)[nth]`. Without it a destructive element at
 * `nth>0` hiding behind a benign first match would be classified
 * non-destructive and skip the confirm. Defaults to the first match (nth 0 /
 * undefined), matching {@link dispatchAction}'s click branch.
 */
export function resolveTarget(selector: string, nth?: number): ResolvedTarget {
  const el = resolveElement(selector, nth);
  if (!el) return {};
  const text = (el.textContent ?? '').trim();
  const ariaLabel = el.getAttribute('aria-label');
  // Closest section/legend/heading text for additional destructive context.
  let nearbyHeading: string | null = null;
  const heading = el
    .closest('section, fieldset, article, [role="region"]')
    ?.querySelector('h1, h2, h3, h4, h5, h6, legend');
  if (heading?.textContent) {
    nearbyHeading = heading.textContent.trim();
  } else {
    // Fall back to the nearest preceding heading in document order.
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, legend'));
    for (const h of headings) {
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
        nearbyHeading = (h.textContent ?? '').trim();
      }
    }
  }
  return {
    text: text.length > 0 ? text : null,
    ariaLabel,
    nearbyHeading,
  };
}
