import { describe, expect, it } from 'vitest';
import {
  extractUserActions,
  queryDomHistory,
  reconstructDomAt,
  userActionsBeforeError,
} from '../src/mcp/event-walker.js';
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
    const b = el('button', { attributes: { id: 'b' } });
    const root = documentWith([b]);
    const events = [
      fullSnapshot(root, 1000),
      clickEvent(b.id, 1100),
      clickEvent(b.id, 1200),
      clickEvent(b.id, 1300), // after the error — excluded
    ];
    const before = userActionsBeforeError(events, 1250, 10);
    expect(before.map((a) => a.ts)).toEqual([1100, 1200]);
  });

  it('caps the window to the most recent N', () => {
    freshIds();
    const b = el('button', { attributes: { id: 'b' } });
    const root = documentWith([b]);
    const events = [fullSnapshot(root, 1000)];
    for (let i = 1; i <= 20; i += 1) events.push(clickEvent(b.id, 1000 + i));
    const before = userActionsBeforeError(events, 9999, 3);
    expect(before).toHaveLength(3);
    expect(before.map((a) => a.ts)).toEqual([1018, 1019, 1020]);
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
