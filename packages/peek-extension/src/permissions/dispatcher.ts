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

/** Mirror of the action union the MCP schema produces (kept minimal/local). */
type DispatchableAction =
  | { type: 'click'; selector: string; nth?: number; button?: 'left' | 'middle' | 'right' }
  | { type: 'type'; selector: string; text: string; delay?: number }
  | { type: 'navigate'; url: string }
  | { type: 'scroll'; selector?: string; x?: number; y?: number }
  // The MVP rejects everything else (back/forward/reload/screenshot/waitFor).
  | { type: string; [k: string]: unknown };

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
      const selector = String((action as { selector?: unknown }).selector ?? '');
      const el = resolveElement(selector, (action as { nth?: number }).nth);
      if (!el) return { ok: false, error: `element not found: ${selector}` };
      (el as HTMLElement).click();
      return { ok: true };
    }
    case 'type': {
      const selector = String((action as { selector?: unknown }).selector ?? '');
      const el = resolveElement(selector);
      if (!el) return { ok: false, error: `element not found: ${selector}` };
      const text =
        typeof (action as { text?: unknown }).text === 'string'
          ? (action as { text: string }).text
          : '';
      // Assign as a plain string value — NEVER innerHTML.
      (el as HTMLInputElement | HTMLTextAreaElement).value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    case 'navigate': {
      const url = String((action as { url?: unknown }).url ?? '');
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
      const sel = (action as { selector?: string }).selector;
      if (typeof sel === 'string' && sel.length > 0) {
        const el = resolveElement(sel);
        if (!el) return { ok: false, error: `element not found: ${sel}` };
        (el as HTMLElement).scrollIntoView();
        return { ok: true };
      }
      const x = Number((action as { x?: unknown }).x ?? 0);
      const y = Number((action as { y?: unknown }).y ?? 0);
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
 */
export function resolveTarget(selector: string): ResolvedTarget {
  const el = resolveElement(selector);
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
