import { describe, expect, it } from 'vitest';
import {
  extractUserActions,
  queryDomHistory,
  reconstructDomAt,
  serializeNode,
  userActionsBeforeError,
} from '../src/mcp/event-walker.js';
import { MAX_DOM_DEPTH } from '../src/mcp/selector.js';
import {
  clickEvent,
  doc,
  documentWith,
  el,
  freshIds,
  fullSnapshot,
  inputEvent,
  metaNav,
  mouseMove,
  mutationEvent,
  text,
} from './fixtures/rrweb.js';

describe('extractUserActions', () => {
  it('extracts clicks, inputs, and navigations with derived selectors, dropping mouse-move noise', () => {
    freshIds();
    const button = el('button', { attributes: { id: 'submit' } });
    const input = el('input', { attributes: { name: 'email' } });
    const root = documentWith([input, button]);

    const events = [
      metaNav('https://app.test/login', 1000),
      fullSnapshot(root, 1000),
      mouseMove(1100), // noise — must be dropped
      inputEvent(input.id, 'me@x.com', 1200),
      clickEvent(button.id, 1300),
      metaNav('https://app.test/dashboard', 1400),
    ];

    const actions = extractUserActions(events);
    expect(actions.map((a) => a.type)).toEqual(['navigate', 'input', 'click', 'navigate']);
    expect(actions[0]).toMatchObject({ type: 'navigate', url: 'https://app.test/login' });
    expect(actions[1]).toMatchObject({
      type: 'input',
      selector: 'input[name="email"]',
      value: 'me@x.com',
    });
    expect(actions[2]).toMatchObject({ type: 'click', selector: '#submit' });
    expect(actions[3]).toMatchObject({ type: 'navigate', url: 'https://app.test/dashboard' });
  });

  it('resolves selectors for nodes inserted by a later mutation', () => {
    freshIds();
    const body = el('body', { children: [] });
    const html = el('html', { children: [body] });
    const root = doc(html);
    const added = el('button', { attributes: { id: 'late' } });

    const events = [
      fullSnapshot(root, 1000),
      mutationEvent({ adds: [{ parentId: body.id, nextId: null, node: added }] }, 1100),
      clickEvent(added.id, 1200),
    ];

    const actions = extractUserActions(events);
    const click = actions.find((a) => a.type === 'click');
    expect(click?.selector).toBe('#late');
  });

  it('carries elementTag on input actions so callers can choose the right Playwright API', () => {
    freshIds();
    const select = el('select', { attributes: { id: 'lang' } });
    const input = el('input', { attributes: { name: 'email' } });
    const root = documentWith([select, input]);
    const events = [
      fullSnapshot(root, 1000),
      inputEvent(select.id, 'en', 1100),
      inputEvent(input.id, 'me@x.com', 1200),
    ];
    const actions = extractUserActions(events);
    const selectAction = actions.find((a) => a.selector === '#lang');
    const inputAction = actions.find((a) => a.selector === 'input[name="email"]');
    expect(selectAction?.elementTag).toBe('select');
    expect(inputAction?.elementTag).toBe('input');
  });

  it('falls back to node#id when the selector is unresolvable', () => {
    freshIds();
    const root = documentWith([el('div')]);
    const events = [fullSnapshot(root, 1000), clickEvent(424242, 1200)];
    const actions = extractUserActions(events);
    expect(actions[0]?.summary).toBe('click node#424242');
    expect(actions[0]?.selector).toBeUndefined();
  });
});

describe('userActionsBeforeError', () => {
  it('returns the last N actions at/before the error timestamp', () => {
    freshIds();
    // Distinct buttons so coalescing doesn't collapse the consecutive clicks.
    const a = el('button', { attributes: { id: 'a' } });
    const b = el('button', { attributes: { id: 'b' } });
    const c = el('button', { attributes: { id: 'c' } });
    const root = documentWith([a, b, c]);
    const events = [
      fullSnapshot(root, 1000),
      clickEvent(a.id, 1100),
      clickEvent(b.id, 1200),
      clickEvent(c.id, 1300), // after the error — excluded
    ];
    const before = userActionsBeforeError(events, 1250, 10);
    expect(before.map((ev) => ev.ts)).toEqual([1100, 1200]);
  });

  it('caps the window to the most recent N', () => {
    freshIds();
    // Distinct buttons so coalescing doesn't collapse the consecutive clicks.
    const buttons = Array.from({ length: 20 }, (_, i) =>
      el('button', { attributes: { id: `b${i}` } }),
    );
    const root = documentWith(buttons);
    const events = [fullSnapshot(root, 1000)];
    for (let i = 1; i <= 20; i += 1) {
      const button = buttons[i - 1];
      if (button) events.push(clickEvent(button.id, 1000 + i));
    }
    const before = userActionsBeforeError(events, 9999, 3);
    expect(before).toHaveLength(3);
    expect(before.map((ev) => ev.ts)).toEqual([1018, 1019, 1020]);
  });
});

describe('reconstructDomAt', () => {
  it('returns the base snapshot html with no mutations applied at snapshot time', () => {
    freshIds();
    const root = documentWith([el('h1', { children: [text('Hello')] })]);
    const events = [fullSnapshot(root, 1000)];
    const snap = reconstructDomAt(events, 1000);
    expect(snap?.mutationsApplied).toBe(0);
    expect(snap?.baseSnapshotTs).toBe(1000);
    expect(snap?.html).toContain('<h1>Hello</h1>');
    expect(snap?.html).toContain('<body>');
  });

  it('applies text + attribute + structural mutations up to ts', () => {
    freshIds();
    const headingText = text('Old');
    const heading = el('h1', { attributes: { class: 'title' }, children: [headingText] });
    const body = el('body', { children: [heading] });
    const html = el('html', { children: [body] });
    const root = doc(html);

    const added = el('p', { attributes: { id: 'note' }, children: [text('added')] });
    const events = [
      fullSnapshot(root, 1000),
      mutationEvent({ texts: [{ id: headingText.id, value: 'New' }] }, 1100),
      mutationEvent({ attributes: [{ id: heading.id, attributes: { class: 'title big' } }] }, 1200),
      mutationEvent({ adds: [{ parentId: body.id, nextId: null, node: added }] }, 1300),
      // After the cutoff — must NOT be applied.
      mutationEvent({ texts: [{ id: headingText.id, value: 'TooLate' }] }, 1400),
    ];

    const snap = reconstructDomAt(events, 1300);
    expect(snap?.mutationsApplied).toBe(3);
    expect(snap?.html).toContain('<h1 class="title big">New</h1>');
    expect(snap?.html).toContain('<p id="note">added</p>');
    expect(snap?.html).not.toContain('TooLate');
  });

  it('scopes to a selector subtree when given', () => {
    freshIds();
    const target = el('div', { attributes: { id: 'panel' }, children: [text('inside')] });
    const other = el('div', { attributes: { id: 'other' }, children: [text('outside')] });
    const root = documentWith([target, other]);
    const events = [fullSnapshot(root, 1000)];
    const snap = reconstructDomAt(events, 1000, '#panel');
    expect(snap?.html).toBe('<div id="panel">inside</div>');
  });

  it('returns undefined when there is no FullSnapshot at or before ts', () => {
    freshIds();
    const root = documentWith([el('div')]);
    const events = [fullSnapshot(root, 5000)];
    expect(reconstructDomAt(events, 1000)).toBeUndefined();
  });

  // J.6 (alpha.7): the recorder now emits a fresh FullSnapshot every 2 minutes
  // (checkoutEveryNms: 120_000). reconstructDomAt MUST root reconstruction at
  // the LATEST FullSnapshot at/before `ts`, not the first — otherwise the
  // checkout cadence buys us nothing and the walker still chews through all
  // mutations from t=0.
  it('uses the LATEST FullSnapshot at/before ts when multiple checkouts exist (J.6 alpha.7)', () => {
    freshIds();
    const initialBody = el('div', { attributes: { id: 'initial' } });
    const initialRoot = documentWith([initialBody]);

    freshIds();
    const checkoutBody = el('div', { attributes: { id: 'after-checkout' } });
    const checkoutRoot = documentWith([checkoutBody]);

    const events = [
      // t=0 — initial FullSnapshot at recording start.
      fullSnapshot(initialRoot, 0),
      // A few incrementals between checkouts (would be expensive to replay).
      mutationEvent({ attributes: [{ id: initialBody.id, attributes: { class: 'a' } }] }, 30_000),
      mutationEvent({ attributes: [{ id: initialBody.id, attributes: { class: 'b' } }] }, 60_000),
      // t=120_001 — checkout FullSnapshot (rrweb fires this when
      // checkoutEveryNms elapses). Fresh DOM, fresh tree.
      fullSnapshot(checkoutRoot, 120_001),
      // A few more incrementals after the checkout.
      mutationEvent({ attributes: [{ id: checkoutBody.id, attributes: { class: 'c' } }] }, 125_000),
    ];

    // Reconstruct at t=130_000 (after the checkout). Result must be rooted at
    // the t=120_001 FullSnapshot — NOT t=0. Two signals:
    //   1. baseSnapshotTs is 120_001 (the checkout), not 0.
    //   2. mutationsApplied is 1 (only the post-checkout mutation), not 3.
    //   3. The reconstructed HTML contains the post-checkout #after-checkout
    //      element, not the initial #initial element.
    const snap = reconstructDomAt(events, 130_000);
    expect(snap?.baseSnapshotTs).toBe(120_001);
    expect(snap?.mutationsApplied).toBe(1);
    expect(snap?.html).toContain('id="after-checkout"');
    expect(snap?.html).not.toContain('id="initial"');
  });
});

describe('queryDomHistory', () => {
  it('returns attribute and text changes for a selector, in order', () => {
    freshIds();
    const statusText = text('Idle');
    const status = el('span', {
      attributes: { id: 'status', class: 'idle' },
      children: [statusText],
    });
    const root = documentWith([status]);

    const events = [
      fullSnapshot(root, 1000),
      mutationEvent({ attributes: [{ id: status.id, attributes: { class: 'loading' } }] }, 1100),
      mutationEvent({ attributes: [{ id: status.id, attributes: { 'aria-busy': 'true' } }] }, 1200),
      mutationEvent({ texts: [{ id: statusText.id, value: 'Done' }] }, 1300),
    ];

    const all = queryDomHistory(events, '#status');
    expect(all).toEqual([
      { ts: 1100, op: 'attribute', attribute: 'class', value: 'loading' },
      { ts: 1200, op: 'attribute', attribute: 'aria-busy', value: 'true' },
      { ts: 1300, op: 'text', value: 'Done' },
    ]);
  });

  it('filters to attributeChanges when op is set', () => {
    freshIds();
    const statusText = text('idle');
    const status = el('span', { attributes: { id: 'status' }, children: [statusText] });
    const root = documentWith([status]);
    const events = [
      fullSnapshot(root, 1000),
      mutationEvent({ attributes: [{ id: status.id, attributes: { class: 'x' } }] }, 1100),
      mutationEvent({ texts: [{ id: statusText.id, value: 'y' }] }, 1200),
    ];
    const attrs = queryDomHistory(events, '#status', { op: 'attributeChanges' });
    expect(attrs).toHaveLength(1);
    expect(attrs[0]).toMatchObject({ op: 'attribute', attribute: 'class' });
  });

  it('returns [] for an unresolvable selector', () => {
    freshIds();
    const root = documentWith([el('div')]);
    const events = [fullSnapshot(root, 1000)];
    expect(queryDomHistory(events, '#nope')).toEqual([]);
  });
});

describe('adversarial robustness', () => {
  it('extractUserActions on a stream with NO FullSnapshot returns clean (no crash)', () => {
    freshIds();
    // A click with no preceding FullSnapshot — index is undefined, selector
    // unresolvable; should fall back to node#id, not throw.
    const events = [metaNav('https://x', 1000), clickEvent(7, 1100)];
    const actions = extractUserActions(events);
    expect(actions.map((a) => a.type)).toEqual(['navigate', 'click']);
    expect(actions[1]?.selector).toBeUndefined();
    expect(actions[1]?.summary).toBe('click node#7');
  });

  it('reconstructDomAt on a stream with NO FullSnapshot returns undefined', () => {
    freshIds();
    const events = [
      metaNav('https://x', 1000),
      mutationEvent({ attributes: [{ id: 1, attributes: { class: 'x' } }] }, 1100),
    ];
    expect(reconstructDomAt(events, 2000)).toBeUndefined();
  });

  it('skips mutation adds with a dangling parentId during DOM reconstruction, no throw', () => {
    freshIds();
    const root = documentWith([el('div', { attributes: { id: 'present' } })]);
    const orphan = el('span', { attributes: { id: 'orphan' } });
    const events = [
      fullSnapshot(root, 1000),
      // parentId 999999 is not in the snapshot — reconstruction must skip the
      // add (no parent to attach to) rather than throw or attach to nothing.
      mutationEvent({ adds: [{ parentId: 999999, nextId: null, node: orphan }] }, 1100),
    ];
    const snap = reconstructDomAt(events, 2000);
    expect(snap).toBeDefined();
    expect(snap?.html).toContain('id="present"');
    expect(snap?.html).not.toContain('id="orphan"');
    // The action walker tolerates the same dangling add + a later click without
    // throwing; the added node's own attributes are known so its selector still
    // resolves (selection doesn't require the parent to be present).
    const actions = extractUserActions([...events, clickEvent(orphan.id, 1200)]);
    const click = actions.find((a) => a.type === 'click');
    expect(click).toBeDefined();
    expect(click?.selector).toBe('#orphan');
  });

  it('serializeNode truncates a deeply-nested tree at the depth guard rather than overflowing', () => {
    freshIds();
    // Build a chain ~3x deeper than the guard. Recursing this without a bound
    // would overflow the stack on most engines.
    const depth = MAX_DOM_DEPTH * 3;
    let node = el('div', { attributes: { class: 'leaf' }, children: [text('bottom')] });
    for (let i = 0; i < depth; i += 1) {
      node = el('div', { children: [node] });
    }
    const html = serializeNode(node);
    expect(html).toContain('[truncated: max depth]');
    // It must NOT have descended all the way to the leaf text.
    expect(html).not.toContain('bottom');
  });

  it('reconstructDomAt does not overflow on a deeply-nested FullSnapshot', () => {
    freshIds();
    let inner = el('div', { children: [text('deep')] });
    for (let i = 0; i < MAX_DOM_DEPTH * 3; i += 1) inner = el('div', { children: [inner] });
    const root = documentWith([inner]);
    const events = [fullSnapshot(root, 1000)];
    // The assertion is simply that this returns without a RangeError.
    const snap = reconstructDomAt(events, 1000);
    expect(snap).toBeDefined();
    expect(snap?.html).toContain('[truncated: max depth]');
  });
});
