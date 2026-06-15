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

describe('shield view — handoff (Plan B)', () => {
  let hv: ReturnType<typeof createShieldView>;

  // The card lives in a CLOSED shadow root the test cannot query. We assert via
  // (1) the light-DOM host's `data-peek-shield-phase` attribute, (2) the guarded
  // `__test` seam (only present when deps.exposeTestSeam === true), and
  // (3) behavior (shield.resume emitted; the capture allow-set predicate).
  beforeEach(() => {
    sent = [];
    hv = createShieldView({
      doc: document,
      win: window,
      sendToSw: (m) => sent.push(m),
      exposeTestSeam: true,
    });
  });
  afterEach(() => {
    hv.dispose();
  });

  function phaseAttr(): string | null {
    return hostEl()?.getAttribute('data-peek-shield-phase') ?? null;
  }

  it('ENTER_HANDOFF (no selector) shows a card with framing + prompt + free-text input; Done emits shield.resume with value', () => {
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    hv.apply({
      kind: 'ENTER_HANDOFF',
      generation: 2,
      prompt: 'Enter the code',
      framing: 'The AI asked you to fill this — peek did not write it.',
    });
    expect(phaseAttr()).toBe('handoff');
    const card = hv.__test?.handoffCard();
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Enter the code');
    expect(card?.textContent).toContain('peek did not write');
    hv.__test?.clickDone('1234');
    expect(
      sent.some((m) => m.type === 'shield.resume' && (m as { value?: string }).value === '1234'),
    ).toBe(true);
  });

  it('during handoff, a real (trusted) edit of the unlocked field is ALLOWED', () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="f">');
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    hv.apply({
      kind: 'ENTER_HANDOFF',
      generation: 2,
      prompt: 'fill',
      framing: 'x',
      selector: '#f',
    });
    const f = document.getElementById('f') as HTMLInputElement;
    const keydown = markTrusted(
      new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }),
    );
    f.dispatchEvent(keydown);
    expect(keydown.defaultPrevented).toBe(false); // unlocked field passes
  });

  it('during handoff, a real edit of a NON-allowed page element is still blocked', () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="other">');
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    document.body.insertAdjacentHTML('beforeend', '<input id="f2">'); // the handoff target
    hv.apply({
      kind: 'ENTER_HANDOFF',
      generation: 2,
      prompt: 'fill',
      framing: 'x',
      selector: '#f2',
    });
    const other = document.getElementById('other') as HTMLInputElement;
    const k = markTrusted(
      new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }),
    );
    other.dispatchEvent(k);
    expect(k.defaultPrevented).toBe(true);
  });

  it('Done in the selector case emits shield.resume with the unlocked field value', () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="sf">');
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    hv.apply({
      kind: 'ENTER_HANDOFF',
      generation: 2,
      prompt: 'fill',
      framing: 'x',
      selector: '#sf',
    });
    const sf = document.getElementById('sf') as HTMLInputElement;
    sf.value = 'typed-by-human';
    hv.__test?.clickDone();
    expect(
      sent.some(
        (m) => m.type === 'shield.resume' && (m as { value?: string }).value === 'typed-by-human',
      ),
    ).toBe(true);
  });

  it('Esc during handoff reaches the field (does NOT fire Stop)', () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="ef">');
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    hv.apply({ kind: 'ENTER_HANDOFF', generation: 2, prompt: 'p', framing: 'f', selector: '#ef' });
    const ef = document.getElementById('ef') as HTMLInputElement;
    const esc = markTrusted(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    ef.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false); // native cancel reaches the field
    expect(sent.some((m) => m.type === 'shield.stop')).toBe(false);
  });

  it('EXIT_HANDOFF removes the card and re-locks to up (phase=up, Stop-only)', () => {
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    hv.apply({ kind: 'ENTER_HANDOFF', generation: 2, prompt: 'p', framing: 'f' });
    hv.apply({ kind: 'EXIT_HANDOFF', generation: 3 });
    expect(hv.__test?.handoffCard()).toBeNull();
    expect(phaseAttr()).toBe('up');
    // back in lockout: a real page click is blocked again
    const page = document.getElementById('page') as HTMLButtonElement | null;
    if (page) {
      const real = markTrusted(new MouseEvent('click', { bubbles: true, cancelable: true }));
      page.dispatchEvent(real);
      expect(real.defaultPrevented).toBe(true);
    }
  });

  it('MutationObserver re-appends a removed host while in handoff (card survives)', async () => {
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    hv.apply({ kind: 'ENTER_HANDOFF', generation: 2, prompt: 'p', framing: 'f' });
    expect(hv.__test?.handoffCard()).not.toBeNull();
    hostEl()?.remove();
    await new Promise((r) => setTimeout(r, 0)); // let the observer fire
    expect(hostEl()).not.toBeNull(); // re-appended even in handoff
    expect(phaseAttr()).toBe('handoff');
    expect(hv.__test?.handoffCard()).not.toBeNull(); // card travels with the host
  });

  it('Done is a no-op on a second click (in-view double-submit guard)', () => {
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    hv.apply({ kind: 'ENTER_HANDOFF', generation: 2, prompt: 'p', framing: 'f' });
    hv.__test?.clickDone('first');
    hv.__test?.clickDone('second'); // card still mounted (no EXIT_HANDOFF yet)
    const resumes = sent.filter((m) => m.type === 'shield.resume');
    expect(resumes).toHaveLength(1);
    expect((resumes[0] as { value?: string }).value).toBe('first');
  });

  it('does not expose the __test seam when exposeTestSeam is unset', () => {
    const plain = createShieldView({ doc: document, win: window, sendToSw: () => {} });
    expect((plain as { __test?: unknown }).__test).toBeUndefined();
    plain.dispose();
  });
});

describe('shield view — page-scope handoff (Part 2)', () => {
  let hv: ReturnType<typeof createShieldView>;

  beforeEach(() => {
    sent = [];
    hv = createShieldView({
      doc: document,
      win: window,
      sendToSw: (m) => sent.push(m),
      exposeTestSeam: true,
    });
  });
  afterEach(() => {
    hv.dispose();
  });

  it('page-scope: a real page click is NOT blocked (full takeover)', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="pb">x</button>');
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    hv.apply({
      kind: 'ENTER_HANDOFF',
      generation: 2,
      prompt: 'Solve CAPTCHA, then Resume',
      framing: 'f',
      scope: 'page',
    });
    const click = markTrusted(new MouseEvent('click', { bubbles: true, cancelable: true }));
    (document.getElementById('pb') as HTMLButtonElement).dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it('page-scope: no free-text input; Resume emits shield.resume with no value', () => {
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    hv.apply({ kind: 'ENTER_HANDOFF', generation: 2, prompt: 'p', framing: 'f', scope: 'page' });
    hv.__test?.clickResume();
    const resume = sent.find((m) => m.type === 'shield.resume');
    expect(resume).toBeDefined();
    expect((resume as { value?: string }).value).toBeUndefined();
  });

  it('field-scope still blocks non-allowed page input (regression)', () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="of"><input id="tf">');
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    hv.apply({ kind: 'ENTER_HANDOFF', generation: 2, prompt: 'p', framing: 'f', selector: '#tf' });
    const k = markTrusted(
      new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }),
    );
    (document.getElementById('of') as HTMLInputElement).dispatchEvent(k);
    expect(k.defaultPrevented).toBe(true);
  });

  it('EXIT_HANDOFF after page-scope restores the lockout (real click blocked again)', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="pb2">x</button>');
    hv.apply({ kind: 'RAISE', generation: 1, label: null });
    hv.apply({ kind: 'ENTER_HANDOFF', generation: 2, prompt: 'p', framing: 'f', scope: 'page' });
    hv.apply({ kind: 'EXIT_HANDOFF', generation: 3 });
    const click = markTrusted(new MouseEvent('click', { bubbles: true, cancelable: true }));
    (document.getElementById('pb2') as HTMLButtonElement).dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });
});
