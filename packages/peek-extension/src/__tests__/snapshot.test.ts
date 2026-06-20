// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { type PageViewResult, buildPageView } from '../permissions/snapshot';

beforeEach(() => {
  // jsdom does no layout — give every element a non-zero rect so isVisible passes.
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return {
      width: 100,
      height: 20,
      top: 0,
      left: 0,
      bottom: 20,
      right: 100,
      x: 0,
      y: 0,
      toJSON() {},
    } as DOMRect;
  };
  (window as unknown as { __peekRefs?: Map<string, Element> | undefined }).__peekRefs = undefined;
  document.body.innerHTML = `
    <h2>Danger Zone</h2>
    <button id="del" aria-label="Delete This Repository">Delete</button>
    <label for="desc">Repository description</label>
    <input id="desc" value="Archived">
    <input id="pw" type="password" value="hunter2">
    <a id="settings" href="/settings">Settings</a>
    <span>just text, no role</span>
  `;
});

describe('buildPageView', () => {
  it('assigns sequential refs and populates the window registry with the elements', () => {
    const view = buildPageView({});
    const refs = view.nodes.map((n) => n.ref);
    expect(refs).toEqual(refs.map((_, i) => `e${i + 1}`)); // e1, e2, …, in order
    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    expect(reg).toBeInstanceOf(Map);
    const delNode = view.nodes.find((n) => n.name === 'Delete This Repository');
    expect(delNode).toBeDefined();
    expect(reg?.get(delNode?.ref ?? '')).toBe(document.getElementById('del'));
  });

  it('derives roles + accessible names (aria-label, label[for], link text)', () => {
    const view = buildPageView({});
    const byName = (name: string) => view.nodes.find((n) => n.name === name);
    expect(byName('Delete This Repository')?.role).toBe('button');
    expect(byName('Repository description')?.role).toBe('textbox'); // named via <label for>
    expect(byName('Settings')?.role).toBe('link');
  });

  it('NEVER emits a raw sensitive input value (password → •••)', () => {
    const view = buildPageView({});
    const pw = view.nodes.find((n) => n.role === 'textbox' && n.value === '•••');
    expect(pw).toBeDefined();
    // The real value must not appear anywhere in the serialized view.
    expect(JSON.stringify(view)).not.toContain('hunter2');
    // A non-sensitive input keeps its (clipped) value.
    expect(view.nodes.find((n) => n.name === 'Repository description')?.value).toBe('Archived');
  });

  it('skips noise nodes with no name and no control role', () => {
    const view = buildPageView({});
    expect(view.nodes.some((n) => n.name === 'just text, no role')).toBe(false);
  });

  it('respects maxElements and flags truncation', () => {
    const view = buildPageView({ maxElements: 2 });
    expect(view.nodes).toHaveLength(2);
    expect(view.truncated).toBe(true);
  });

  it('scopes the walk to a selector subtree', () => {
    document.body.innerHTML = `
      <div id="a"><button>In A</button></div>
      <div id="b"><button>In B</button></div>
    `;
    const view = buildPageView({ selector: '#b' });
    const names = view.nodes.map((n) => n.name);
    expect(names).toContain('In B');
    expect(names).not.toContain('In A');
  });

  it('masks PII-autofill + privacy-annotated fields precisely (drops bday/address, keeps username)', () => {
    document.body.innerHTML = `
      <input aria-label="bday" autocomplete="bday" value="1990-01-02">
      <input aria-label="addr" autocomplete="address-level2" value="Springfield">
      <input aria-label="user" autocomplete="username" value="ada">
      <input aria-label="note" value="plain text">
      <input aria-label="secret" class="rr-mask" value="hidden value">
    `;
    const v = buildPageView({});
    const get = (name: string) => v.nodes.find((n) => n.name === name)?.value;
    expect(get('bday')).toBe('•••'); // PII autofill dropped
    expect(get('addr')).toBe('•••'); // address dropped (was missed by the old substring matcher)
    expect(get('user')).toBe('ada'); // username shown (was over-masked before)
    expect(get('note')).toBe('plain text'); // free-text non-PII kept (consistent with recorder)
    expect(get('secret')).toBe('•••'); // .rr-mask honored
    expect(JSON.stringify(v)).not.toContain('hidden value');
  });

  it('is self-contained: survives MAIN-world serialization (no module-scope helpers)', () => {
    // Mirror executeScript({world:'MAIN', func}) — reconstruct from source in a
    // scope WITHOUT any module-scope helpers, then run it.
    const reconstructed = new Function(
      `return (${buildPageView.toString()})`,
    )() as typeof buildPageView;
    const view = reconstructed({}) as PageViewResult;
    expect(view.ok).toBe(true);
    expect(view.nodes.length).toBeGreaterThan(0);
    expect(view.nodes.find((n) => n.name === 'Delete This Repository')?.role).toBe('button');
  });
});
