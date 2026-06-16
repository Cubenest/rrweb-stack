/**
 * MAIN-world in-page action feedback (the "peek just acted here" cue).
 *
 * SECURITY / SERIALIZATION BOUNDARY — read before editing:
 *   • `showElementFeedback` / `showPageToast` execute in the PAGE's MAIN world,
 *     injected via `chrome.scripting.executeScript({ world: 'MAIN', func })`.
 *     Chrome serializes ONLY each function's own source — so they must be
 *     SELF-CONTAINED: every helper (resolveElement, makeRing, makeRipple) is
 *     nested, and the CSS + host marker are passed in via `args` (NOT imported).
 *     Same discipline as dispatcher.ts / highlight.ts.
 *   • All UI lives inside a CLOSED shadow root (rrweb cannot serialize it → the
 *     cue never lands in a recording, with no placeholder box). The host is
 *     `display:contents` (no layout box of its own).
 *   • `selector` is an untrusted CSS string — passed ONLY to querySelector. No
 *     value/text is ever rendered (egress discipline): cues are geometry only.
 *   • The page-toast message is built from a fixed verb→string map + a host string;
 *     assigned via `textContent`, never innerHTML.
 *
 * Motion is CSS-driven and gated behind `@media (prefers-reduced-motion:
 * no-preference)`; reduced-motion users get a brief STATIC cue. Mirrors the
 * `<style>`-in-closed-shadow idiom of shield/view.ts.
 */

/** Serializable result the SW ignores (feedback is fire-and-forget). */
export type FeedbackResult = { ok: true };

/** The single stylesheet injected into each effect's closed shadow root. */
export const FEEDBACK_CSS = `
.peek-fx-ring {
  all: initial;
  position: fixed;
  box-sizing: border-box;
  pointer-events: none;
  z-index: 2147483647;
  border-radius: 4px;
  border: 2px solid #6366f1;
  opacity: 1;
}
.peek-fx-ring--type { border-color: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.25); }
.peek-fx-ring--scroll { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25); }
.peek-fx-ripple {
  all: initial;
  position: fixed;
  box-sizing: border-box;
  pointer-events: none;
  z-index: 2147483647;
  border-radius: 50%;
  opacity: 1;
}
.peek-fx-ripple--click { background: rgba(99, 102, 241, 0.30); border: 2px solid #6366f1; }
.peek-fx-ripple--enter { background: rgba(245, 158, 11, 0.30); border: 2px solid #f59e0b; }
.peek-fx-toast {
  all: initial;
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483647;
  box-sizing: border-box;
  max-width: 320px;
  padding: 8px 14px;
  border-radius: 8px;
  background: #1e1b4b;
  color: #fff;
  font: 13px/1.4 system-ui, sans-serif;
  pointer-events: none;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
  opacity: 1;
}
@media (prefers-reduced-motion: no-preference) {
  .peek-fx-ring { animation: peek-fx-ring 700ms ease-out forwards; }
  .peek-fx-ring--scroll { animation: peek-fx-pulse 500ms ease-out forwards; }
  .peek-fx-ripple { animation: peek-fx-ripple 500ms ease-out forwards; }
  .peek-fx-toast { animation: peek-fx-toast 2200ms ease-out forwards; }
  @keyframes peek-fx-ring {
    0% { opacity: 0; transform: scale(0.98); }
    25% { opacity: 1; transform: scale(1); }
    75% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes peek-fx-pulse {
    0% { opacity: 0; transform: scale(1); }
    30% { opacity: 1; transform: scale(1.03); }
    100% { opacity: 0; transform: scale(1); }
  }
  @keyframes peek-fx-ripple {
    0% { opacity: 1; transform: scale(0.4); }
    100% { opacity: 0; transform: scale(2.2); }
  }
  @keyframes peek-fx-toast {
    0% { opacity: 0; transform: translateY(-8px); }
    10% { opacity: 1; transform: translateY(0); }
    85% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-8px); }
  }
}
@media print {
  .peek-fx-ring, .peek-fx-ripple, .peek-fx-toast { display: none !important; }
}
`;

/** Args for the injected element-feedback function. */
export interface ElementFeedbackArgs {
  verb: 'click' | 'type' | 'enter' | 'dblclick' | 'scroll';
  selector: string;
  nth?: number;
  hostAttr: string;
  css: string;
  /** Test-only: 'open' lets jsdom inspect the shadow. Production omits it → 'closed'. */
  mode?: 'open' | 'closed';
}

/**
 * Draw the per-verb cue on the element matching `selector`. Self-contained for
 * MAIN-world injection. Best-effort: a missing element is a silent no-op (the
 * cue must never affect the action result). Returns `{ ok: true }` always.
 */
export function showElementFeedback(args: ElementFeedbackArgs): FeedbackResult {
  // INLINED for MAIN-world injection — keep in sync with dispatcher.ts.
  function resolveElement(selector: string, nth?: number): Element | null {
    if (typeof selector !== 'string' || selector.length === 0) return null;
    try {
      if (typeof nth === 'number' && nth > 0) {
        return document.querySelectorAll(selector).item(nth) ?? null;
      }
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  const el = resolveElement(args.selector, args.nth);
  if (!el) return { ok: true };
  const rect = el.getBoundingClientRect();

  const host = document.createElement('div');
  host.setAttribute(args.hostAttr, '');
  host.setAttribute('aria-hidden', 'true');
  host.style.setProperty('display', 'contents');
  const shadow = host.attachShadow({ mode: args.mode ?? 'closed' });

  const style = document.createElement('style');
  style.textContent = args.css;
  shadow.append(style);

  const makeRing = (modifier: string): HTMLElement => {
    const ring = document.createElement('div');
    ring.className = `peek-fx-ring ${modifier}`;
    ring.style.top = `${rect.top}px`;
    ring.style.left = `${rect.left}px`;
    ring.style.width = `${rect.width}px`;
    ring.style.height = `${rect.height}px`;
    return ring;
  };
  const makeRipple = (modifier: string, delayMs?: number): HTMLElement => {
    const d = Math.max(24, Math.min(rect.width, rect.height));
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const ripple = document.createElement('div');
    ripple.className = `peek-fx-ripple ${modifier}`;
    ripple.style.width = `${d}px`;
    ripple.style.height = `${d}px`;
    ripple.style.left = `${cx - d / 2}px`;
    ripple.style.top = `${cy - d / 2}px`;
    if (typeof delayMs === 'number') ripple.style.animationDelay = `${delayMs}ms`;
    return ripple;
  };

  switch (args.verb) {
    case 'type':
      shadow.append(makeRing('peek-fx-ring--type'));
      break;
    case 'scroll':
      shadow.append(makeRing('peek-fx-ring--scroll'));
      break;
    case 'click':
      shadow.append(makeRipple('peek-fx-ripple--click'));
      break;
    case 'enter':
      shadow.append(makeRipple('peek-fx-ripple--enter'));
      break;
    case 'dblclick':
      shadow.append(makeRipple('peek-fx-ripple--click'));
      shadow.append(makeRipple('peek-fx-ripple--click', 120));
      break;
  }

  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), 900);
  return { ok: true };
}

/** Args for the injected page-toast function. */
export interface PageToastArgs {
  verb: 'navigate' | 'reload' | 'back' | 'forward';
  /** Host portion of the destination URL (e.g. "example.com"). Host-only — never a full URL (egress discipline). */
  detail?: string;
  hostAttr: string;
  css: string;
  mode?: 'open' | 'closed';
}

/**
 * Draw a corner toast naming a page-level action on the DESTINATION document.
 * Self-contained for MAIN-world injection. Message is a fixed verb→string map;
 * `detail` (a host string) is rendered via textContent only.
 */
export function showPageToast(args: PageToastArgs): FeedbackResult {
  let message: string;
  switch (args.verb) {
    case 'navigate':
      message = args.detail ? `peek navigated to ${args.detail}` : 'peek navigated';
      break;
    case 'reload':
      message = 'peek reloaded the page';
      break;
    case 'back':
      message = 'peek went back';
      break;
    case 'forward':
      message = 'peek went forward';
      break;
  }

  const host = document.createElement('div');
  host.setAttribute(args.hostAttr, '');
  host.setAttribute('aria-hidden', 'true');
  host.style.setProperty('display', 'contents');
  const shadow = host.attachShadow({ mode: args.mode ?? 'closed' });

  const style = document.createElement('style');
  style.textContent = args.css;
  const pill = document.createElement('div');
  pill.className = 'peek-fx-toast';
  pill.textContent = message; // textContent, NEVER innerHTML
  shadow.append(style, pill);

  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), 2200);
  return { ok: true };
}

/** A resolved element-cue plan (which verb + how to find the element). */
export interface ElementFeedbackPlan {
  verb: 'click' | 'type' | 'enter' | 'dblclick' | 'scroll';
  selector: string;
  nth?: number;
}

/** A resolved page-toast plan. */
export interface PageToastPlan {
  verb: 'navigate' | 'reload' | 'back' | 'forward';
  detail?: string;
}

/** Permissive action shape (the SW's protocol Action is assignable to this). */
type ActionLike = { readonly type: string; readonly [k: string]: unknown };

/**
 * Decide the on-element cue for an action, or null if it gets none. Selector-
 * less `enter` (activeElement) and coordinate `scroll` are skipped — there's no
 * stable element to ring after the fact.
 */
export function elementFeedbackFor(action: ActionLike): ElementFeedbackPlan | null {
  const sel = typeof action.selector === 'string' ? action.selector : '';
  if (sel.length === 0) return null;
  switch (action.type) {
    case 'click':
    case 'dblclick': {
      const plan: ElementFeedbackPlan = { verb: action.type, selector: sel };
      if (typeof action.nth === 'number') plan.nth = action.nth;
      return plan;
    }
    case 'type':
    case 'enter':
    case 'scroll':
      return { verb: action.type, selector: sel };
    default:
      return null;
  }
}

/** Decide the page-level toast for an action, or null if it gets none. */
export function pageToastFor(action: ActionLike): PageToastPlan | null {
  switch (action.type) {
    case 'navigate': {
      const url = typeof action.url === 'string' ? action.url : '';
      const plan: PageToastPlan = { verb: 'navigate' };
      try {
        plan.detail = new URL(url).host;
      } catch {
        // unparseable URL — leave detail absent
      }
      return plan;
    }
    case 'reload':
      return { verb: 'reload' };
    case 'back':
      return { verb: 'back' };
    case 'forward':
      return { verb: 'forward' };
    default:
      return null;
  }
}
