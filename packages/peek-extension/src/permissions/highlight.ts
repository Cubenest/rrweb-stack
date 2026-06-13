/**
 * MAIN-world DOM highlight overlay (Level-2 "Suggest" tier, ADR-0010).
 *
 * SECURITY / SERIALIZATION BOUNDARY — read before editing:
 *   • Both functions execute in the PAGE's MAIN world, injected via
 *     `chrome.scripting.executeScript({ world: 'MAIN', func })`. Chrome
 *     serializes ONLY each function's own source into the page — so they must
 *     be SELF-CONTAINED: every constant (SENTINEL/COLOR/Z) and helper (anchor)
 *     is declared INSIDE the function body. A module-scope reference would be
 *     `undefined` in the page (ReferenceError). Same discipline as dispatcher.ts.
 *   • `selector` is an untrusted CSS string from the AI client. It is passed
 *     ONLY to `document.querySelector` — never interpolated into HTML, never
 *     evaluated. `label` is assigned via `textContent` — never innerHTML.
 *   • The overlay is `pointer-events:none` and non-mutating: it draws a ring,
 *     it never clicks/types/navigates. This is what makes it Level-2-safe.
 *   • Every return value is a plain serializable object so it survives the
 *     `executeScript` result boundary.
 */

/** Serializable result the SW forwards back to the host. */
export type HighlightResult = { ok: true } | { ok: false; error: string };

/**
 * Draw (or move) the single highlight overlay onto `selector`. Replace-on-
 * reapply: any existing overlay is removed first, so calling twice moves the
 * ring rather than stacking. Never throws — an invalid/absent selector returns
 * `{ ok: false, error }`.
 */
export function applyHighlight(selector: string, label?: string): HighlightResult {
  // INLINED for MAIN-world injection — do NOT hoist to module scope.
  const SENTINEL = '__peek_highlight__';
  const COLOR = '#6366f1';
  const Z = '2147483647';

  if (typeof selector !== 'string' || selector.length === 0) {
    return { ok: false, error: 'invalid selector: (empty)' };
  }
  let el: Element | null;
  try {
    el = document.querySelector(selector);
  } catch {
    // An invalid selector string throws a SyntaxError.
    return { ok: false, error: `invalid selector: ${selector}` };
  }
  if (!el) return { ok: false, error: `element not found: ${selector}` };

  // Replace-on-reapply: drop any existing overlay + its window listeners.
  const existing = document.body.querySelector(`.${SENTINEL}`);
  if (existing) {
    const prev = (
      existing as unknown as {
        __peekListeners?: { scroll: () => void; resize: () => void };
      }
    ).__peekListeners;
    if (prev) {
      window.removeEventListener('scroll', prev.scroll);
      window.removeEventListener('resize', prev.resize);
    }
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = SENTINEL;
  overlay.style.position = 'fixed';
  overlay.style.border = `2px solid ${COLOR}`;
  overlay.style.borderRadius = '3px';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = Z;
  overlay.style.boxSizing = 'border-box';
  overlay.style.margin = '0';

  if (typeof label === 'string' && label.length > 0) {
    const badge = document.createElement('span');
    badge.textContent = label; // textContent, NEVER innerHTML
    badge.style.position = 'absolute';
    badge.style.left = '0';
    badge.style.top = '100%';
    badge.style.background = COLOR;
    badge.style.color = '#fff';
    badge.style.font = '12px/1 sans-serif';
    badge.style.padding = '2px 6px';
    badge.style.borderRadius = '0 0 3px 3px';
    badge.style.whiteSpace = 'nowrap';
    overlay.appendChild(badge);
  }

  const target = el;
  const anchor = (): void => {
    const r = target.getBoundingClientRect();
    overlay.style.top = `${r.top}px`;
    overlay.style.left = `${r.left}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
  };
  anchor();
  document.body.appendChild(overlay);

  const onScroll = (): void => anchor();
  const onResize = (): void => anchor();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  (
    overlay as unknown as {
      __peekListeners: { scroll: () => void; resize: () => void };
    }
  ).__peekListeners = { scroll: onScroll, resize: onResize };

  return { ok: true };
}

/**
 * Remove the active highlight overlay + its window listeners. Idempotent:
 * returns `{ ok: true }` even when no overlay is present. Self-contained for
 * MAIN-world injection.
 */
export function clearHighlight(): HighlightResult {
  const SENTINEL = '__peek_highlight__';
  const overlay = document.body.querySelector(`.${SENTINEL}`);
  if (!overlay) return { ok: true }; // idempotent
  const listeners = (
    overlay as unknown as {
      __peekListeners?: { scroll: () => void; resize: () => void };
    }
  ).__peekListeners;
  if (listeners) {
    window.removeEventListener('scroll', listeners.scroll);
    window.removeEventListener('resize', listeners.resize);
  }
  overlay.remove();
  return { ok: true };
}
