// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction, resolveTarget } from '../permissions/dispatcher';

beforeEach(() => {
  document.body.innerHTML = `
    <h2>Account settings</h2>
    <button id="b" aria-label="Save">Save now</button>
    <input id="i">
    <a id="lnk" href="#">link</a>
    <button class="dup">first</button>
    <button class="dup">second</button>
    <div id="tall" style="height: 9999px">x</div>
  `;
});

describe('dispatchAction — click', () => {
  it('resolves the selector, clicks it, and returns ok', async () => {
    let clicked = false;
    document.getElementById('b')?.addEventListener('click', () => {
      clicked = true;
    });
    expect(await dispatchAction({ type: 'click', selector: '#b', button: 'left' })).toEqual({
      ok: true,
    });
    expect(clicked).toBe(true);
  });

  it('supports nth to disambiguate multiple matches', async () => {
    const order: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.dup'))) {
      el.addEventListener('click', () => order.push(el.textContent ?? ''));
    }
    expect(
      await dispatchAction({ type: 'click', selector: '.dup', nth: 1, button: 'left' }),
    ).toEqual({
      ok: true,
    });
    expect(order).toEqual(['second']);
  });

  it('returns ok:false for a missing selector', async () => {
    expect(await dispatchAction({ type: 'click', selector: '#nope', button: 'left' })).toEqual({
      ok: false,
      error: expect.stringMatching(/not found/i),
    });
  });
});

describe('dispatchAction — type', () => {
  it('sets value + fires input and change', async () => {
    const events: string[] = [];
    const input = document.getElementById('i') as HTMLInputElement;
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    expect(await dispatchAction({ type: 'type', selector: '#i', text: 'hi', delay: 0 })).toEqual({
      ok: true,
    });
    expect(input.value).toBe('hi');
    expect(events).toContain('input');
    expect(events).toContain('change');
  });

  it('returns ok:false typing into a non-existent element', async () => {
    expect(
      await dispatchAction({ type: 'type', selector: '#missing', text: 'x', delay: 0 }),
    ).toEqual({
      ok: false,
      error: expect.stringMatching(/not found/i),
    });
  });
});

describe('dispatchAction — navigate', () => {
  it('rejects a non-http(s) URL without navigating', async () => {
    const res = await dispatchAction({ type: 'navigate', url: 'javascript:alert(1)' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/url/i);
  });

  it('accepts an http(s) URL', async () => {
    // jsdom doesn't actually navigate; we assert the dispatcher reports ok and
    // doesn't throw for a well-formed http(s) URL.
    const res = await dispatchAction({ type: 'navigate', url: 'https://example.com/next' });
    expect(res.ok).toBe(true);
  });
});

describe('dispatchAction — scroll', () => {
  it('scrolls to absolute coordinates', async () => {
    let target: { x: number; y: number } | null = null;
    window.scrollTo = ((x: number, y: number) => {
      target = { x, y };
    }) as typeof window.scrollTo;
    expect(await dispatchAction({ type: 'scroll', x: 0, y: 500 })).toEqual({ ok: true });
    expect(target).toEqual({ x: 0, y: 500 });
  });

  it('scrolls a selected element into view', async () => {
    const el = document.getElementById('tall') as HTMLElement;
    let called = false;
    el.scrollIntoView = (() => {
      called = true;
    }) as typeof el.scrollIntoView;
    expect(await dispatchAction({ type: 'scroll', selector: '#tall' })).toEqual({ ok: true });
    expect(called).toBe(true);
  });

  it('returns ok:false scrolling to a missing selector', async () => {
    const res = await dispatchAction({ type: 'scroll', selector: '#gone' });
    expect(res.ok).toBe(false);
  });
});

describe('dispatchAction — back / forward / reload', () => {
  it('back: returns ok and calls history.back when there is an entry to go back to', async () => {
    let backCalled = false;
    const realBack = window.history.back;
    window.history.back = (() => {
      backCalled = true;
    }) as typeof window.history.back;
    // jsdom's history.length is 1 by default; force a multi-entry stack so the
    // guard passes.
    const lengthSpy = vi.spyOn(window.history, 'length', 'get').mockReturnValue(2);
    try {
      expect(await dispatchAction({ type: 'back' })).toEqual({ ok: true });
      expect(backCalled).toBe(true);
    } finally {
      lengthSpy.mockRestore();
      window.history.back = realBack;
    }
  });

  it('back: returns ok:false when there is no history entry to go back to', async () => {
    let backCalled = false;
    const realBack = window.history.back;
    window.history.back = (() => {
      backCalled = true;
    }) as typeof window.history.back;
    const lengthSpy = vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    try {
      const res = await dispatchAction({ type: 'back' });
      expect(res).toEqual({ ok: false, error: 'no history entry to go back to' });
      expect(backCalled).toBe(false);
    } finally {
      lengthSpy.mockRestore();
      window.history.back = realBack;
    }
  });

  it('forward: returns ok and calls history.forward', async () => {
    let forwardCalled = false;
    const realForward = window.history.forward;
    window.history.forward = (() => {
      forwardCalled = true;
    }) as typeof window.history.forward;
    try {
      expect(await dispatchAction({ type: 'forward' })).toEqual({ ok: true });
      expect(forwardCalled).toBe(true);
    } finally {
      window.history.forward = realForward;
    }
  });

  it('reload: returns ok and calls location.reload', async () => {
    // jsdom's window.location.reload is non-writable AND non-configurable, so it
    // cannot be reassigned or spied on. It IS a non-throwing no-op in jsdom, so
    // we assert the dispatcher's observable contract: it calls reload (a no-op
    // here) and resolves a bare { ok:true } without throwing.
    await expect(dispatchAction({ type: 'reload' })).resolves.toEqual({ ok: true });
  });
});

describe('dispatchAction — waitFor', () => {
  it('matches immediately for an already-attached selector', async () => {
    const res = await dispatchAction({ type: 'waitFor', selector: '#b', timeoutMs: 1000 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.details).toMatchObject({ matched: true });
  });

  it('resolves when the element is appended after the call (MutationObserver path)', async () => {
    const pending = dispatchAction({ type: 'waitFor', selector: '#late', timeoutMs: 2000 });
    // Append on the next macrotask so the observer (not the fast path) fires.
    setTimeout(() => {
      const el = document.createElement('div');
      el.id = 'late';
      document.body.appendChild(el);
    }, 10);
    const res = await pending;
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.details).toMatchObject({ matched: true });
  });

  it('selector given but never attached → ok:false with matched:false after timeout', async () => {
    const res = await dispatchAction({ type: 'waitFor', selector: '#never', timeoutMs: 20 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('waitFor timed out: #never');
      expect(res.details).toMatchObject({ matched: false });
    }
  });

  it('no selector (pure delay) → ok:true with matched:false after the delay', async () => {
    const res = await dispatchAction({ type: 'waitFor', timeoutMs: 20 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.details).toMatchObject({ matched: false });
  });
});

describe('dispatchAction — enter', () => {
  it('with selector: focuses the element and dispatches Enter keydown/keypress/keyup', async () => {
    const input = document.getElementById('i') as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener('keydown', (e) => events.push(`keydown:${e.key}`));
    input.addEventListener('keypress', (e) => events.push(`keypress:${e.key}`));
    input.addEventListener('keyup', (e) => events.push(`keyup:${e.key}`));
    const res = await dispatchAction({ type: 'enter', selector: '#i' });
    expect(res.ok).toBe(true);
    expect(events).toEqual(['keydown:Enter', 'keypress:Enter', 'keyup:Enter']);
  });

  it('without selector: dispatches to document.activeElement', async () => {
    const btn = document.getElementById('b') as HTMLElement;
    btn.focus();
    const events: string[] = [];
    btn.addEventListener('keydown', (e) => events.push(e.key));
    const res = await dispatchAction({ type: 'enter' });
    expect(res.ok).toBe(true);
    expect(events).toContain('Enter');
  });

  it('with selector for a missing element → ok:false', async () => {
    const res = await dispatchAction({ type: 'enter', selector: '#missing-element' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/element not found/);
  });
});

describe('dispatchAction — dblclick', () => {
  it('dispatches a dblclick event on the target element', async () => {
    const btn = document.getElementById('b') as HTMLElement;
    let dblclicked = false;
    btn.addEventListener('dblclick', () => {
      dblclicked = true;
    });
    const res = await dispatchAction({ type: 'dblclick', selector: '#b', button: 'left' } as never);
    expect(res.ok).toBe(true);
    expect(dblclicked).toBe(true);
  });

  it('missing element → ok:false', async () => {
    const res = await dispatchAction({
      type: 'dblclick',
      selector: '#missing',
      button: 'left',
    } as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/element not found/);
  });
});

describe('dispatchAction — unsupported action', () => {
  // screenshot is NEVER a dispatcher case BY DESIGN — it needs
  // chrome.tabs.captureVisibleTab (an SW-only API absent from the MAIN world),
  // so background.ts intercepts it before routing here. A screenshot that
  // reached the dispatcher SHOULD fall through to default → rejected; this
  // sentinel documents that boundary. Do NOT add a `case 'screenshot'`.
  it('returns ok:false for an action type the MVP does not handle', async () => {
    const res = await dispatchAction({ type: 'screenshot' } as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/unsupported/i);
  });
});

// --- SERIALIZATION boundary (the executeScript({ world:'MAIN', func }) path) ---
//
// dispatchAction / resolveTarget are passed by reference to
// chrome.scripting.executeScript({ world:'MAIN', func }). Chrome serializes ONLY
// the function's own `.toString()` source into the page — module-scope helpers
// (resolveElement) do NOT travel. The tests above call the functions directly in
// jsdom where resolveElement IS in module scope, so they can't catch a missing
// dependency. These reconstruct each function from its source in a scope WITHOUT
// resolveElement (exactly what the page's MAIN world sees) and assert it neither
// throws a ReferenceError nor silently no-ops. `new Function` closes over only
// globals (document/window/URL/Event/…), not this module — mirroring the page.
describe('MAIN-world serialization (no module-scope helpers in the page)', () => {
  /** Rebuild a fn from its source in a scope with NO module-scope helpers. */
  function reconstructInPageScope<T extends (...args: never[]) => unknown>(fn: T): T {
    // Reconstruct from `.toString()` in a fresh scope (no module-scope helpers),
    // emulating what executeScript serializes into the page's MAIN world.
    return new Function(`return (${fn.toString()})`)() as T;
  }

  it('dispatchAction({type:"type"}) actually sets .value after serialization', async () => {
    const injected = reconstructInPageScope(dispatchAction);
    const input = document.getElementById('i') as HTMLInputElement;
    // The reconstructed fn now returns a Promise — await it and assert on the
    // resolved value (no ReferenceError on the inlined resolveElement).
    await expect(injected({ type: 'type', selector: '#i', text: 'hi', delay: 0 })).resolves.toEqual(
      { ok: true },
    );
    expect(input.value).toBe('hi');
  });

  it('dispatchAction({type:"click"}) actually clicks after serialization', async () => {
    const injected = reconstructInPageScope(dispatchAction);
    let clicked = false;
    document.getElementById('b')?.addEventListener('click', () => {
      clicked = true;
    });
    await expect(injected({ type: 'click', selector: '#b', button: 'left' })).resolves.toEqual({
      ok: true,
    });
    expect(clicked).toBe(true);
  });

  it('dispatchAction({type:"scroll", selector}) scrolls into view after serialization', async () => {
    const injected = reconstructInPageScope(dispatchAction);
    const el = document.getElementById('tall') as HTMLElement;
    let called = false;
    el.scrollIntoView = (() => {
      called = true;
    }) as typeof el.scrollIntoView;
    await expect(injected({ type: 'scroll', selector: '#tall' })).resolves.toEqual({ ok: true });
    expect(called).toBe(true);
  });

  it('dispatchAction({type:"forward"}) calls history.forward after serialization', async () => {
    const injected = reconstructInPageScope(dispatchAction);
    let forwardCalled = false;
    const realForward = window.history.forward;
    window.history.forward = (() => {
      forwardCalled = true;
    }) as typeof window.history.forward;
    try {
      await expect(injected({ type: 'forward' })).resolves.toEqual({ ok: true });
      expect(forwardCalled).toBe(true);
    } finally {
      window.history.forward = realForward;
    }
  });

  it('dispatchAction({type:"reload"}) calls location.reload after serialization', async () => {
    const injected = reconstructInPageScope(dispatchAction);
    // jsdom's window.location.reload is non-writable AND non-configurable, so it
    // can't be stubbed; it IS a non-throwing no-op. The point of this test is
    // that the inlined branch runs in a helper-free page scope without a
    // ReferenceError and resolves a serializable bare { ok:true }.
    await expect(injected({ type: 'reload' })).resolves.toEqual({ ok: true });
  });

  it('dispatchAction({type:"back"}) guards history.length after serialization', async () => {
    const injected = reconstructInPageScope(dispatchAction);
    // history.length is 1 in jsdom → the guard returns ok:false. The point of
    // this test is that the inlined branch runs in a helper-free scope without
    // a ReferenceError and resolves a serializable value.
    const lengthSpy = vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    try {
      await expect(injected({ type: 'back' })).resolves.toEqual({
        ok: false,
        error: 'no history entry to go back to',
      });
    } finally {
      lengthSpy.mockRestore();
    }
  });

  it('dispatchAction({type:"waitFor"}) resolves the MutationObserver race after serialization', async () => {
    const injected = reconstructInPageScope(dispatchAction);
    // Already-attached selector → fast path, no ReferenceError on the inlined
    // matches()/observer logic. Then a timed-out, no-selector pure delay to
    // exercise the await + observer/timeout cleanup path in page scope.
    await expect(
      injected({ type: 'waitFor', selector: '#b', timeoutMs: 1000 }),
    ).resolves.toMatchObject({ ok: true, details: { matched: true } });
    await expect(injected({ type: 'waitFor', timeoutMs: 20 })).resolves.toMatchObject({
      ok: true,
      details: { matched: false },
    });
  });

  it('dispatchAction({type:"enter"}) fires keyboard events after serialization', async () => {
    const injected = reconstructInPageScope(dispatchAction);
    const input = document.getElementById('i') as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener('keydown', (e) => events.push(e.key));
    // Focus the element so enter without selector dispatches to it.
    input.focus();
    await expect(injected({ type: 'enter', selector: '#i' })).resolves.toEqual({ ok: true });
    expect(events).toContain('Enter');
  });

  it('dispatchAction({type:"dblclick"}) fires dblclick event after serialization', async () => {
    const injected = reconstructInPageScope(dispatchAction);
    const btn = document.getElementById('b') as HTMLElement;
    let dblclicked = false;
    btn.addEventListener('dblclick', () => {
      dblclicked = true;
    });
    await expect(injected({ type: 'dblclick', selector: '#b' })).resolves.toEqual({ ok: true });
    expect(dblclicked).toBe(true);
  });

  it('resolveTarget resolves matcher signals after serialization', () => {
    const injected = reconstructInPageScope(resolveTarget);
    let res: unknown;
    expect(() => {
      res = injected('#b');
    }).not.toThrow();
    expect(res).toMatchObject({
      text: 'Save now',
      ariaLabel: 'Save',
      nearbyHeading: 'Account settings',
    });
  });
});

describe('resolveTarget', () => {
  it('returns text + ariaLabel + nearbyHeading for the matched element', () => {
    expect(resolveTarget('#b')).toMatchObject({
      text: 'Save now',
      ariaLabel: 'Save',
      nearbyHeading: 'Account settings',
    });
  });

  it('returns an empty target for a missing selector (never throws)', () => {
    expect(resolveTarget('#nope')).toEqual({});
  });

  it('returns an empty target for an empty selector', () => {
    expect(resolveTarget('')).toEqual({});
  });

  it('item B (nth): resolves the SAME nth element the click will hit (not the first match)', () => {
    // A destructive element hiding behind a non-destructive first match. The
    // action is `click .nthrow [nth=1]`, which the dispatcher resolves to the
    // SECOND element. The destructive matcher must classify THAT element — not
    // the benign first match — or it would skip confirm on a destructive click.
    document.body.innerHTML = `
      <button class="nthrow">Save changes</button>
      <button class="nthrow">Delete account</button>
    `;
    // nth=0 (or omitted) → the benign first match.
    expect(resolveTarget('.nthrow')).toMatchObject({ text: 'Save changes' });
    expect(resolveTarget('.nthrow', 0)).toMatchObject({ text: 'Save changes' });
    // nth=1 → the destructive second match (the one the click hits).
    expect(resolveTarget('.nthrow', 1)).toMatchObject({ text: 'Delete account' });
  });

  it('item B (nth): an out-of-range nth resolves to an empty target (never throws)', () => {
    document.body.innerHTML = '<button class="only">One</button>';
    expect(resolveTarget('.only', 5)).toEqual({});
  });
});
