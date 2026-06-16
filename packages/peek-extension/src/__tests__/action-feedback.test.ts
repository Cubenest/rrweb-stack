// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_CSS, showElementFeedback } from '../permissions/action-feedback';

const HOST = 'data-peek-fx';

beforeEach(() => {
  document.body.innerHTML = `<button id="b">Save</button><input id="i">`;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  for (const n of document.documentElement.querySelectorAll(`[${HOST}]`)) {
    n.remove();
  }
});

describe('showElementFeedback', () => {
  it('appends a display:contents host carrying the feedback marker', () => {
    showElementFeedback({ verb: 'click', selector: '#b', hostAttr: HOST, css: FEEDBACK_CSS });
    const host = document.documentElement.querySelector(`[${HOST}]`) as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.style.display).toBe('contents');
    expect(host.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses a CLOSED shadow root in production (default mode)', () => {
    showElementFeedback({ verb: 'click', selector: '#b', hostAttr: HOST, css: FEEDBACK_CSS });
    const host = document.documentElement.querySelector(`[${HOST}]`) as HTMLElement;
    expect(host.shadowRoot).toBeNull(); // closed → inaccessible → rrweb can't serialize
  });

  it('click → a ripple node inside the shadow (inspected via test-only open mode)', () => {
    showElementFeedback({
      verb: 'click',
      selector: '#b',
      hostAttr: HOST,
      css: FEEDBACK_CSS,
      mode: 'open',
    });
    const host = document.documentElement.querySelector(`[${HOST}]`) as HTMLElement;
    const ripple = host.shadowRoot?.querySelector('.peek-fx-ripple.peek-fx-ripple--click');
    expect(ripple).not.toBeNull();
  });

  it('type → a ring node sized from the element rect, with no typed text rendered', () => {
    showElementFeedback({
      verb: 'type',
      selector: '#i',
      hostAttr: HOST,
      css: FEEDBACK_CSS,
      mode: 'open',
    });
    const host = document.documentElement.querySelector(`[${HOST}]`) as HTMLElement;
    const ring = host.shadowRoot?.querySelector('.peek-fx-ring.peek-fx-ring--type') as HTMLElement;
    expect(ring).not.toBeNull();
    // egress discipline: the cue is geometry only — it never echoes a value.
    // Exclude the <style> element (CSS constants) — only check non-CSS child text.
    const nonStyleText = [...(host.shadowRoot?.childNodes ?? [])]
      .filter((n) => n.nodeName !== 'STYLE')
      .map((n) => n.textContent ?? '')
      .join('');
    expect(nonStyleText).toBe('');
  });

  it('dblclick → two ripples, the second delayed', () => {
    showElementFeedback({
      verb: 'dblclick',
      selector: '#b',
      hostAttr: HOST,
      css: FEEDBACK_CSS,
      mode: 'open',
    });
    const host = document.documentElement.querySelector(`[${HOST}]`) as HTMLElement;
    const ripples = host.shadowRoot?.querySelectorAll('.peek-fx-ripple') ?? [];
    expect(ripples.length).toBe(2);
    expect((ripples[1] as HTMLElement).style.animationDelay).toBe('120ms');
  });

  it('enter → an amber ripple', () => {
    showElementFeedback({
      verb: 'enter',
      selector: '#b',
      hostAttr: HOST,
      css: FEEDBACK_CSS,
      mode: 'open',
    });
    const host = document.documentElement.querySelector(`[${HOST}]`) as HTMLElement;
    expect(host.shadowRoot?.querySelector('.peek-fx-ripple--enter')).not.toBeNull();
  });

  it('scroll → an indigo ring', () => {
    showElementFeedback({
      verb: 'scroll',
      selector: '#b',
      hostAttr: HOST,
      css: FEEDBACK_CSS,
      mode: 'open',
    });
    const host = document.documentElement.querySelector(`[${HOST}]`) as HTMLElement;
    expect(host.shadowRoot?.querySelector('.peek-fx-ring--scroll')).not.toBeNull();
  });

  it('removes the host after the effect duration (not before)', () => {
    showElementFeedback({ verb: 'click', selector: '#b', hostAttr: HOST, css: FEEDBACK_CSS });
    expect(document.documentElement.querySelector(`[${HOST}]`)).not.toBeNull();
    vi.advanceTimersByTime(899);
    expect(document.documentElement.querySelector(`[${HOST}]`)).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(document.documentElement.querySelector(`[${HOST}]`)).toBeNull();
  });

  it('is a best-effort no-op for a missing selector (never an error, never a node)', () => {
    expect(
      showElementFeedback({ verb: 'click', selector: '#nope', hostAttr: HOST, css: FEEDBACK_CSS }),
    ).toEqual({ ok: true });
    expect(document.documentElement.querySelector(`[${HOST}]`)).toBeNull();
  });
});

describe('FEEDBACK_CSS', () => {
  it('gates motion behind prefers-reduced-motion and hides on print', () => {
    expect(FEEDBACK_CSS).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(FEEDBACK_CSS).toContain('@media print');
    expect(FEEDBACK_CSS).toContain('@keyframes peek-fx-ripple');
    expect(FEEDBACK_CSS).toContain('@keyframes peek-fx-ring');
  });
});

// Mirrors highlight.test.ts: reconstruct the fn from .toString() in a scope with
// NO module-scope helpers, proving it survives executeScript serialization.
describe('MAIN-world serialization (no module-scope helpers in the page)', () => {
  function reconstructInPageScope<T extends (...args: never[]) => unknown>(fn: T): T {
    return new Function(`return (${fn.toString()})`)() as T;
  }
  it('showElementFeedback runs after serialization (no out-of-scope refs)', () => {
    const injected = reconstructInPageScope(showElementFeedback);
    let res: unknown;
    expect(() => {
      res = injected({
        verb: 'click',
        selector: '#b',
        hostAttr: HOST,
        css: FEEDBACK_CSS,
        mode: 'open',
      });
    }).not.toThrow();
    expect(res).toEqual({ ok: true });
    expect(document.documentElement.querySelector(`[${HOST}]`)).not.toBeNull();
  });
});
