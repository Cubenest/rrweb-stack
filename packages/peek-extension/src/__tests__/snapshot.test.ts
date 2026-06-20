// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ElementDetail,
  type PageViewNode,
  type PageViewResult,
  buildElementDetail,
  buildPageView,
  diffPageView,
} from '../permissions/snapshot';

/** Wipe all four MAIN-world ref globals so stability tests start fresh. */
function resetRefGlobals(): void {
  const w = window as unknown as {
    __peekRefs?: unknown;
    __peekRefByEl?: unknown;
    __peekRefSeq?: unknown;
    __peekLastView?: unknown;
  };
  w.__peekRefs = undefined;
  w.__peekRefByEl = undefined;
  w.__peekRefSeq = undefined;
  w.__peekLastView = undefined;
}

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
  resetRefGlobals();
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

describe('buildPageView — stable refs (R2)', () => {
  it('keeps the same ref for the same element across two snapshots', () => {
    const first = buildPageView({});
    const delFirst = first.nodes.find((n) => n.name === 'Delete This Repository')?.ref;
    const second = buildPageView({});
    const delSecond = second.nodes.find((n) => n.name === 'Delete This Repository')?.ref;
    expect(delFirst).toBeDefined();
    expect(delSecond).toBe(delFirst); // identity-stable across snapshots
  });

  it('gives a NEW element a fresh higher e{N}; surviving elements keep their numbers', () => {
    const first = buildPageView({});
    const settingsRef = first.nodes.find((n) => n.name === 'Settings')?.ref;
    const maxSeqBefore = (window as unknown as { __peekRefSeq?: number }).__peekRefSeq ?? 0;

    // Add a brand-new element.
    const fresh = document.createElement('button');
    fresh.textContent = 'Newly Added';
    document.body.appendChild(fresh);

    const second = buildPageView({});
    const newRef = second.nodes.find((n) => n.name === 'Newly Added')?.ref;
    // Surviving element keeps its ref.
    expect(second.nodes.find((n) => n.name === 'Settings')?.ref).toBe(settingsRef);
    // New element gets a fresh higher number than any previously issued.
    expect(newRef).toBeDefined();
    const newNum = Number((newRef ?? 'e0').slice(1));
    expect(newNum).toBeGreaterThan(maxSeqBefore);
  });

  it("removes a removed element's ref from __peekRefs after the next snapshot (survivors keep numbers)", () => {
    const first = buildPageView({});
    const settingsRef = first.nodes.find((n) => n.name === 'Settings')?.ref;
    const delRef = first.nodes.find((n) => n.name === 'Delete This Repository')?.ref ?? '';

    document.getElementById('del')?.remove();
    buildPageView({});

    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    expect(reg?.has(delRef)).toBe(false); // removed element's ref absent → resolves as expired
    expect(reg?.has(settingsRef ?? '')).toBe(true); // survivor still present
    expect(reg?.get(settingsRef ?? '')).toBe(document.getElementById('settings'));
  });

  it('is still the forward map named __peekRefs (dispatcher contract)', () => {
    buildPageView({});
    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    expect(reg).toBeInstanceOf(Map);
    // The very first issued ref on a fresh registry is e1.
    expect(reg?.get('e1')).toBeInstanceOf(Element);
  });

  it('stores the node list in __peekLastView for diffing', () => {
    const view = buildPageView({});
    const last = (window as unknown as { __peekLastView?: PageViewNode[] }).__peekLastView;
    expect(Array.isArray(last)).toBe(true);
    expect(last).toEqual(view.nodes);
  });
});

describe('diffPageView (R2)', () => {
  it('classifies everything as added when there is no previous view', () => {
    // No prior buildPageView → __peekLastView is empty.
    const delta = diffPageView({});
    expect(delta.removed).toEqual([]);
    expect(delta.changed).toEqual([]);
    expect(delta.added.length).toBeGreaterThan(0);
    expect(delta.added.some((n) => n.name === 'Settings')).toBe(true);
  });

  it('surfaces a value change in `changed`, not `added`', () => {
    buildPageView({}); // seed __peekLastView
    const desc = document.getElementById('desc') as HTMLInputElement;
    desc.value = 'Updated description';

    const delta = diffPageView({});
    const changedNames = delta.changed.map((n) => n.name);
    expect(changedNames).toContain('Repository description');
    expect(delta.added.some((n) => n.name === 'Repository description')).toBe(false);
    expect(delta.changed.find((n) => n.name === 'Repository description')?.value).toBe(
      'Updated description',
    );
  });

  it('reports a newly added element in `added`', () => {
    buildPageView({});
    const fresh = document.createElement('button');
    fresh.textContent = 'Diff Added Button';
    document.body.appendChild(fresh);

    const delta = diffPageView({});
    expect(delta.added.some((n) => n.name === 'Diff Added Button')).toBe(true);
    expect(delta.changed.some((n) => n.name === 'Diff Added Button')).toBe(false);
  });

  it('reports a removed element ref in `removed`', () => {
    const first = buildPageView({});
    const delRef = first.nodes.find((n) => n.name === 'Delete This Repository')?.ref ?? '';
    document.getElementById('del')?.remove();

    const delta = diffPageView({});
    expect(delta.removed).toContain(delRef);
    expect(delta.added.some((n) => n.name === 'Delete This Repository')).toBe(false);
  });

  it('returns an empty delta when nothing changed between snapshots', () => {
    buildPageView({});
    const delta = diffPageView({});
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.changed).toEqual([]);
  });

  it('is self-contained: survives MAIN-world serialization (reconstructed with buildPageView)', () => {
    // diffPageView references buildPageView; the controller injects them together.
    // Reconstruct buildPageView into the page scope, then diffPageView referencing it.
    const fn = new Function(
      `const buildPageView = (${buildPageView.toString()});\n` +
        `return (${diffPageView.toString()})`,
    )() as typeof diffPageView;
    const delta = fn({});
    expect(Array.isArray(delta.added)).toBe(true);
    expect(Array.isArray(delta.removed)).toBe(true);
    expect(Array.isArray(delta.changed)).toBe(true);
    expect(typeof delta.url).toBe('string');
  });
});

describe('buildElementDetail (R2)', () => {
  it('returns full untruncated name + aria-* + state + context.heading + capped children', () => {
    document.body.innerHTML = `
      <main>
        <h2>Account Settings</h2>
        <div id="panel"
             role="region"
             aria-label="${'A very long accessible name '.repeat(20)}"
             aria-describedby="hint"
             aria-expanded="true">
          <button>Save</button>
          <button>Cancel</button>
          <a href="/help">Help</a>
        </div>
      </main>
    `;
    buildPageView({}); // register refs
    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    let panelRef = '';
    for (const [r, el] of reg?.entries() ?? []) {
      if (el === document.getElementById('panel')) panelRef = r;
    }
    expect(panelRef).not.toBe('');

    const detail = buildElementDetail(panelRef) as ElementDetail;
    expect(detail.ok).toBe(true);
    expect(detail.tag).toBe('div');
    expect(detail.role).toBe('region');
    // FULL untruncated name (>200 chars; buildPageView would clip, detail does not).
    expect(detail.name.length).toBeGreaterThan(200);
    // every aria-* attribute is present.
    expect(detail.aria['aria-describedby']).toBe('hint');
    expect(detail.aria['aria-expanded']).toBe('true');
    // aria holds the RAW attribute value; name is the accName-normalized form.
    expect(detail.aria['aria-label']?.trim()).toBe(detail.name);
    // state includes expanded.
    expect(detail.state).toContain('expanded=true');
    // nearest preceding heading.
    expect(detail.context?.heading).toBe('Account Settings');
    // landmark (the <main> ancestor).
    expect(detail.context?.landmark).toBe('main');
    // direct interactive children, each with a ref, capped at 20.
    expect(detail.children?.length).toBe(3);
    expect(detail.children?.map((c) => c.name)).toEqual(['Save', 'Cancel', 'Help']);
    for (const c of detail.children ?? []) expect(c.ref).toMatch(/^e\d+$/);
  });

  it('caps direct interactive children at 20', () => {
    const container = document.createElement('div');
    container.id = 'big';
    container.setAttribute('role', 'group'); // make it registrable by buildPageView
    for (let i = 0; i < 30; i++) {
      const b = document.createElement('button');
      b.textContent = `Btn ${i}`;
      container.appendChild(b);
    }
    document.body.appendChild(container);
    buildPageView({});
    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    let ref = '';
    for (const [r, el] of reg?.entries() ?? []) {
      if (el === container) ref = r;
    }
    expect(ref).not.toBe('');
    const detail = buildElementDetail(ref) as ElementDetail;
    expect(detail.children?.length).toBe(20);
  });

  it('masks a sensitive (password) input value to •••', () => {
    document.body.innerHTML = `<input id="secret" type="password" value="hunter2">`;
    buildPageView({});
    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    let ref = '';
    for (const [r, el] of reg?.entries() ?? []) {
      if (el === document.getElementById('secret')) ref = r;
    }
    const detail = buildElementDetail(ref) as ElementDetail;
    expect(detail.value).toBe('•••');
    expect(JSON.stringify(detail)).not.toContain('hunter2');
  });

  it('NEVER contains an outerHTML/innerHTML key', () => {
    buildPageView({});
    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    const ref = reg ? [...reg.keys()][0] : '';
    const detail = buildElementDetail(ref ?? '') as ElementDetail;
    expect('outerHTML' in detail).toBe(false);
    expect('innerHTML' in detail).toBe(false);
  });

  it('returns {ok:false, error:/ref expired/} for an expired/missing ref', () => {
    buildPageView({});
    const missing = buildElementDetail('e9999');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/ref expired/);
  });

  it('returns {ok:false} when the resolved element is detached', () => {
    buildPageView({});
    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    let ref = '';
    for (const [r, el] of reg?.entries() ?? []) {
      if (el === document.getElementById('del')) ref = r;
    }
    document.getElementById('del')?.remove(); // detach without re-snapshot → still in map but !isConnected
    const detail = buildElementDetail(ref);
    expect(detail.ok).toBe(false);
    if (!detail.ok) expect(detail.error).toMatch(/ref expired/);
  });

  it('is self-contained: survives MAIN-world serialization (no module-scope helpers)', () => {
    buildPageView({});
    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    const ref = reg ? [...reg.keys()][0] : 'e1';
    const fn = new Function(
      `return (${buildElementDetail.toString()})`,
    )() as typeof buildElementDetail;
    const detail = fn(ref ?? 'e1');
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(typeof detail.tag).toBe('string');
      expect(Array.isArray(detail.state)).toBe(true);
    }
  });
});
