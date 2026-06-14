// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShieldInbound } from '../shield/protocol';
import { SHIELD_CSS, SHIELD_HOST_ATTR, createShieldView } from '../shield/view';

let sent: ShieldInbound[];
let view: ReturnType<typeof createShieldView>;

// jsdom (25.x) forces `isTrusted` to a non-configurable accessor that reads its
// internal impl and resets to `false` at the start of every `dispatchEvent`, so
// `Object.defineProperty(ev, 'isTrusted', …)` is impossible and any value set
// before dispatch is overwritten before listeners run. To exercise the view's
// real `e.isTrusted` branch we mark specific events as "trusted" and re-flip the
// impl-backed flag inside a capture listener registered BEFORE the view's own
// (same-phase listeners fire in registration order), so the view sees true.
const TRUSTED = new WeakSet<Event>();
const CAPTURED_EVENTS = [
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'pointerdown',
  'pointerup',
  'keydown',
  'keyup',
  'input',
  'beforeinput',
  'paste',
  'cut',
  'drop',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'wheel',
];
const implSym = (ev: Event): symbol | undefined =>
  (Object.getOwnPropertySymbols(ev) as symbol[]).find((s) => String(s) === 'Symbol(impl)');
const reflipTrusted = (e: Event): void => {
  if (!TRUSTED.has(e)) return;
  const s = implSym(e);
  if (!s) return;
  const impl = (e as unknown as Record<symbol, { isTrusted: boolean }>)[s];
  if (impl) impl.isTrusted = true;
};
/** Tag an event so the view's listener observes `isTrusted === true`. */
function markTrusted<T extends Event>(e: T): T {
  TRUSTED.add(e);
  return e;
}

beforeEach(() => {
  document.documentElement.innerHTML = '<body><button id="page">page</button></body>';
  sent = [];
  // Register the re-flip listener FIRST so it runs before the view's capture
  // listener, which createShieldView attaches on construction.
  for (const type of CAPTURED_EVENTS) {
    window.addEventListener(type, reflipTrusted, { capture: true });
  }
  view = createShieldView({ doc: document, win: window, sendToSw: (m) => sent.push(m) });
});
afterEach(() => {
  view.dispose();
  for (const type of CAPTURED_EVENTS) {
    window.removeEventListener(type, reflipTrusted, { capture: true });
  }
  vi.restoreAllMocks();
});

function hostEl(): HTMLElement | null {
  return document.documentElement.querySelector(`[${SHIELD_HOST_ATTR}]`);
}

describe('shield view', () => {
  it('sends shield.ready on creation', () => {
    expect(sent.some((m) => m.type === 'shield.ready')).toBe(true);
  });

  it('RAISE mounts a closed-shadow host; LOWER removes it', () => {
    view.apply({ kind: 'RAISE', generation: 1, label: 'Working' });
    const host = hostEl();
    expect(host).not.toBeNull();
    expect(host?.style.display).toBe('contents');
    expect(host?.shadowRoot).toBeNull(); // closed
    view.apply({ kind: 'LOWER', generation: 2 });
    expect(hostEl()).toBeNull();
  });

  it('blocks an isTrusted page click while up; allows a synthetic (isTrusted:false) click', () => {
    view.apply({ kind: 'RAISE', generation: 1, label: null });
    const page = document.getElementById('page') as HTMLButtonElement;
    const pageHandler = vi.fn();
    page.addEventListener('click', pageHandler);

    // Synthetic click (el.click() => isTrusted:false) reaches the page handler.
    page.click();
    expect(pageHandler).toHaveBeenCalledTimes(1);

    // A "real" (isTrusted:true) click is swallowed by the capture listener.
    const real = markTrusted(new MouseEvent('click', { bubbles: true, cancelable: true }));
    page.dispatchEvent(real);
    expect(pageHandler).toHaveBeenCalledTimes(1); // unchanged
    expect(real.defaultPrevented).toBe(true);
  });

  it('Esc while up emits shield.stop', () => {
    view.apply({ kind: 'RAISE', generation: 1, label: null });
    const esc = markTrusted(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(esc);
    expect(sent.some((m) => m.type === 'shield.stop')).toBe(true);
  });

  it('drops a stale-generation command', () => {
    view.apply({ kind: 'RAISE', generation: 5, label: null });
    view.apply({ kind: 'LOWER', generation: 2 }); // stale -> ignored
    expect(hostEl()).not.toBeNull();
    // and it re-announces readiness so the SW can converge
    expect(sent.filter((m) => m.type === 'shield.ready').length).toBeGreaterThan(1);
  });

  it('MutationObserver re-appends a removed host while up', async () => {
    view.apply({ kind: 'RAISE', generation: 1, label: null });
    hostEl()?.remove();
    await new Promise((r) => setTimeout(r, 0)); // let the observer fire
    expect(hostEl()).not.toBeNull();
  });

  it('does not block scroll/wheel', () => {
    view.apply({ kind: 'RAISE', generation: 1, label: null });
    const wheel = markTrusted(new WheelEvent('wheel', { bubbles: true, cancelable: true }));
    window.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });

  // Spec §12 test 21: the overlay's animation must be gated behind
  // prefers-reduced-motion. jsdom can't evaluate @media, so this is a
  // string-level guard that the gate isn't accidentally removed (the breathe
  // animation must live ONLY inside the no-preference block).
  it('gates animation behind prefers-reduced-motion', () => {
    expect(SHIELD_CSS).toContain('@media (prefers-reduced-motion: no-preference)');
    const gateIdx = SHIELD_CSS.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(SHIELD_CSS.indexOf('animation:')).toBeGreaterThan(gateIdx);
  });
});
