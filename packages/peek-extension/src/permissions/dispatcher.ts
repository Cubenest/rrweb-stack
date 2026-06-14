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
 * background.ts can hand the SW's `action` straight through.
 *
 * The dispatcher handles eight in-page verbs: click / type / navigate / scroll
 * / back / forward / reload / waitFor. `screenshot` is the ONE verb NOT handled
 * here — it needs `chrome.tabs.captureVisibleTab`, an SW-only API absent from
 * the page's MAIN world — so background.ts intercepts it before routing to this
 * dispatcher (a `screenshot` that reached here would hit the `default` →
 * rejected; the sentinel test documents that boundary by design).
 */
type DispatchableAction = { readonly type: string; readonly [k: string]: unknown };

/**
 * The serializable result the SW forwards back to the host. Both variants may
 * carry `details` — `waitFor` attaches `{ matched, elapsedMs }` even on the
 * timed-out failure path so the caller can see how long it waited.
 */
export type DispatchResult =
  | { ok: true; details?: unknown }
  | { ok: false; error: string; details?: unknown };

/**
 * Resolve a single element for an untrusted selector (+ optional nth match).
 *
 * NOTE: this logic is INLINED as a nested `resolveElement` inside both
 * {@link dispatchAction} and {@link resolveTarget} — they must be self-contained
 * for MAIN-world injection (a module-scope helper does NOT travel through
 * `chrome.scripting.executeScript({ world: 'MAIN', func })`'s `.toString()`
 * serialization and would be `undefined` in the page → ReferenceError). There is
 * intentionally no module-scope copy here: keeping one would be dead code (and
 * tempt a future caller into reintroducing the serialization bug). Keep the two
 * nested copies in sync if you change the resolution behavior.
 */

/**
 * Execute one allowed action in the page. Self-contained + serializable result.
 * Returns `{ ok: false, error }` for any failure (missing element, bad URL,
 * unsupported action) — never throws.
 *
 * Async because `waitFor` awaits a MutationObserver/timeout race. Chrome's
 * `executeScript` awaits a returned Promise and surfaces the resolved value as
 * `frame.result`, so the synchronous branches simply resolve immediately.
 */
export async function dispatchAction(action: DispatchableAction): Promise<DispatchResult> {
  // INLINED for MAIN-world injection: `dispatchAction` is passed by reference to
  // `chrome.scripting.executeScript({ world: 'MAIN', func })`, which serializes
  // ONLY this function's own source into the page. A module-scope helper would
  // be `undefined` there (ReferenceError on first use). Declare resolveElement
  // as a nested function so it travels with the dispatcher. Keep it in sync with
  // the identical nested copy in resolveTarget.
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
    case 'back': {
      // BARE ok (no details) — matches the navigate precedent.
      if (window.history.length <= 1) {
        return { ok: false, error: 'no history entry to go back to' };
      }
      window.history.back();
      return { ok: true };
    }
    case 'forward': {
      window.history.forward();
      return { ok: true };
    }
    case 'reload': {
      window.location.reload();
      return { ok: true };
    }
    case 'waitFor': {
      // Wait for `selector` to attach to the DOM (non-null querySelector — NOT
      // visibility), OR — when no selector is given — for a pure delay to
      // elapse. Self-contained for MAIN-world injection: ALL helper logic lives
      // nested in this branch (no module-scope deps survive `.toString()`).
      const selector = typeof action.selector === 'string' ? action.selector : '';
      // Clamp under the 5-min host-bridge timeout so the await always resolves
      // before the host gives up on the request.
      const requested = typeof action.timeoutMs === 'number' ? action.timeoutMs : 5000;
      const timeout = Math.min(requested, 240000);
      const startedAt = performance.now();
      const matches = (): boolean => {
        if (selector.length === 0) return false;
        try {
          return document.querySelector(selector) !== null;
        } catch {
          // Invalid selector string throws a SyntaxError — treat as no match.
          return false;
        }
      };
      // Fast path: already attached.
      if (matches()) {
        return { ok: true, details: { matched: true, elapsedMs: performance.now() - startedAt } };
      }
      // Race a MutationObserver (resolves on first match) against a timeout cap.
      const matched = await new Promise<boolean>((resolve) => {
        let observer: MutationObserver | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = (result: boolean): void => {
          if (observer) observer.disconnect();
          if (timer !== null) clearTimeout(timer);
          resolve(result);
        };
        observer = new MutationObserver(() => {
          if (matches()) finish(true);
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        timer = setTimeout(() => finish(false), timeout);
      });
      const elapsedMs = performance.now() - startedAt;
      if (matched) {
        return { ok: true, details: { matched: true, elapsedMs } };
      }
      // No selector given → a pure delay that completed: success.
      if (selector.length === 0) {
        return { ok: true, details: { matched: false, elapsedMs } };
      }
      // Selector given but never attached within the cap: failure.
      return {
        ok: false,
        error: `waitFor timed out: ${selector}`,
        details: { matched: false, elapsedMs },
      };
    }
    case 'enter': {
      // Focus the selector if given; otherwise dispatch to the currently active
      // element. Fires keydown → keypress → keyup so both native form-submit
      // handlers and framework key-listener patterns receive the full sequence.
      const selector = typeof action.selector === 'string' ? action.selector : '';
      let target: Element | null;
      if (selector.length > 0) {
        target = resolveElement(selector);
        if (!target) return { ok: false, error: `element not found: ${selector}` };
        (target as HTMLElement).focus?.();
      } else {
        target = document.activeElement;
      }
      const el = (target ?? document.body) as HTMLElement;
      const opts: KeyboardEventInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      };
      el.dispatchEvent(new KeyboardEvent('keydown', opts));
      el.dispatchEvent(new KeyboardEvent('keypress', opts));
      el.dispatchEvent(new KeyboardEvent('keyup', opts));
      return { ok: true };
    }
    case 'dblclick': {
      const selector = typeof action.selector === 'string' ? action.selector : '';
      const nth = typeof action.nth === 'number' ? action.nth : undefined;
      const el = resolveElement(selector, nth);
      if (!el) return { ok: false, error: `element not found: ${selector}` };
      (el as HTMLElement).dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
      );
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
  // INLINED for MAIN-world injection (see dispatchAction): this function is also
  // serialized into the page via `executeScript({ world: 'MAIN', func })`, so it
  // must not depend on the module-scope resolveElement. Declare it nested.
  function resolveElement(sel: string, n?: number): Element | null {
    if (typeof sel !== 'string' || sel.length === 0) return null;
    try {
      if (typeof n === 'number' && n > 0) {
        const all = document.querySelectorAll(sel);
        return all.item(n) ?? null;
      }
      return document.querySelector(sel);
    } catch {
      // An invalid selector string throws a SyntaxError — treat as not found.
      return null;
    }
  }
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

/** Eligibility + sensitivity metadata for a handoff target (Plan B). */
export interface HandoffEligibility {
  editable: boolean;
  tagName: string | null;
  inputType: string | null;
  autocomplete: string | null;
  destructiveSignals: {
    text?: string | null;
    ariaLabel?: string | null;
    nearbyHeading?: string | null;
  };
  isConnected: boolean;
}

/**
 * MAIN-world: resolve whether `selector` points at a single editable, inspectable
 * element + the signals the SW needs to gate a handoff. Self-contained (inline
 * helpers) because it is serialized via executeScript({world:'MAIN'}). Never throws.
 */
export function resolveHandoffEligibility(selector: string): HandoffEligibility {
  const empty: HandoffEligibility = {
    editable: false,
    tagName: null,
    inputType: null,
    autocomplete: null,
    destructiveSignals: {},
    isConnected: false,
  };
  if (typeof selector !== 'string' || selector.length === 0) return empty;
  let el: Element | null;
  try {
    el = document.querySelector(selector);
  } catch {
    return empty;
  }
  if (!el) return empty;
  const tag = el.tagName;
  const inputType = el instanceof HTMLInputElement ? el.type : null;
  const autocomplete = el.getAttribute('autocomplete');
  // `isContentEditable` is the real-browser signal; jsdom does not implement it,
  // so fall back to the HTML-spec `contenteditable` attribute ('' / 'true' /
  // 'plaintext-only' mean editable) for the same semantics under test.
  const ceAttr = el.getAttribute('contenteditable');
  const contentEditable =
    (el as HTMLElement).isContentEditable === true ||
    ceAttr === '' ||
    ceAttr === 'true' ||
    ceAttr === 'plaintext-only';
  const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || contentEditable;
  const text = (el.textContent ?? '').trim().slice(0, 200) || null;
  const ariaLabel = el.getAttribute('aria-label');
  return {
    editable,
    tagName: tag,
    inputType,
    autocomplete,
    destructiveSignals: { text, ariaLabel, nearbyHeading: null },
    isConnected: el.isConnected,
  };
}
