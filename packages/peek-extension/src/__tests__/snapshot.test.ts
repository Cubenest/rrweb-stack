// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ElementDetail,
  type PageViewDelta,
  type PageViewNode,
  type PageViewResult,
  buildElementDetail,
  buildPageView,
  diffPageView,
  diffPageViewStandalone,
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
    // .rr-mask honored — FIX 1 (HIGH): both the NAME and the value of an
    // explicitly-masked field are now •••  (previously the name "secret" leaked).
    // Autofill-only masks (bday/addr) redact the VALUE but NOT the name; only a
    // privacy-ANNOTATED region (.rr-mask) also redacts the name — so the masked
    // node is the one whose NAME is •••.
    const secret = v.nodes.find((n) => n.name === '•••');
    expect(secret, 'the .rr-mask field is registered with a •••  name').toBeDefined();
    expect(secret?.value).toBe('•••');
    expect(v.nodes.some((n) => n.name === 'secret')).toBe(false); // name no longer leaks
    // The autofill-masked fields keep their REAL names (only the value is •••).
    expect(v.nodes.find((n) => n.name === 'bday')?.value).toBe('•••');
    expect(JSON.stringify(v)).not.toContain('hidden value');
  });

  it('masks the NAME (not just the value) of a privacy-annotated element to •••', () => {
    // FIX 1 (HIGH): a free-text element inside a masked region leaked its
    // accessible NAME at Level 1 (only input VALUES were honored). Both the name
    // AND the value of an explicitly-masked field must be •••  in-page.
    document.body.innerHTML = `
      <div data-private>
        <button aria-label="Pay Jane Doe $4,200">Send money</button>
        <input aria-label="Recipient account" value="123456789">
      </div>
      <button aria-label="Public button">OK</button>
    `;
    const v = buildPageView({});
    // The masked region's NAMES are redacted — the cleartext PII is gone.
    expect(v.nodes.some((n) => n.name === 'Pay Jane Doe $4,200')).toBe(false);
    expect(JSON.stringify(v)).not.toContain('Jane Doe');
    expect(JSON.stringify(v)).not.toContain('123456789');
    // The masked input still emits a node, with both name + value redacted.
    const maskedInput = v.nodes.find((n) => n.role === 'textbox');
    expect(maskedInput?.name).toBe('•••');
    expect(maskedInput?.value).toBe('•••');
    // A button outside the masked region keeps its real name.
    expect(v.nodes.some((n) => n.name === 'Public button')).toBe(true);
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

describe('diffPageViewStandalone (R2 — the function the SW actually injects)', () => {
  it('is FULLY self-contained: survives MAIN-world serialization with NO out-of-scope identifier', () => {
    // This is the load-bearing guard for the observe path. The SW injects this
    // function BARE via executeScript({func: diffPageViewStandalone}) — NO eval,
    // NO buildPageView passed alongside (it nests buildPageView itself). If it
    // referenced ANY module-scope identifier (e.g. the sibling buildPageView),
    // reconstructing it in a helper-free scope would throw ReferenceError in the
    // page. We reconstruct in exactly that empty scope and run it.
    const reconstructed = new Function(
      `return (${diffPageViewStandalone.toString()})`,
    )() as typeof diffPageViewStandalone;
    buildPageView({}); // seed __peekLastView via the canonical walker
    const delta = reconstructed({}) as PageViewDelta;
    expect(Array.isArray(delta.added)).toBe(true);
    expect(Array.isArray(delta.removed)).toBe(true);
    expect(Array.isArray(delta.changed)).toBe(true);
    expect(typeof delta.url).toBe('string');
  });

  it('does NOT use new Function / eval (CSP-safe in MAIN world)', () => {
    // MAIN-world injected code runs under the PAGE's CSP; `new Function`/`eval`
    // are blocked on any site without `unsafe-eval`. Guard the source has neither.
    const src = diffPageViewStandalone.toString();
    expect(src).not.toMatch(/new\s+Function/);
    expect(src).not.toMatch(/\beval\s*\(/);
  });

  it('produces the SAME delta as the canonical diffPageView (parity — no drift)', () => {
    // A value change must classify identically under both implementations.
    buildPageView({}); // seed
    (document.getElementById('desc') as HTMLInputElement).value = 'Changed once';
    const canonical = diffPageView({});

    // Re-seed an identical starting state, apply the same change, run standalone.
    resetRefGlobals();
    document.body.innerHTML = `
      <h2>Danger Zone</h2>
      <button id="del" aria-label="Delete This Repository">Delete</button>
      <label for="desc">Repository description</label>
      <input id="desc" value="Archived">
      <a id="settings" href="/settings">Settings</a>
    `;
    buildPageView({}); // seed
    (document.getElementById('desc') as HTMLInputElement).value = 'Changed once';
    const standalone = diffPageViewStandalone({});

    const names = (d: PageViewDelta) => ({
      changed: d.changed.map((n) => n.name).sort(),
      added: d.added.map((n) => n.name).sort(),
      removed: [...d.removed].sort(),
    });
    expect(names(standalone)).toEqual(names(canonical));
    expect(standalone.changed.find((n) => n.name === 'Repository description')?.value).toBe(
      'Changed once',
    );
  });

  it('refreshes __peekLastView so a second standalone diff is empty when nothing changed', () => {
    buildPageView({});
    diffPageViewStandalone({}); // refreshes __peekLastView
    const second = diffPageViewStandalone({});
    expect(second.added).toEqual([]);
    expect(second.changed).toEqual([]);
    expect(second.removed).toEqual([]);
  });

  it('MASKING parity: standalone + canonical redact a password value + a masked name IDENTICALLY', () => {
    // FIX 2 (MEDIUM): the existing parity test only checks diff CLASSIFICATION.
    // The standalone walker carries a VERBATIM copy of the privacy logic; this
    // guards that its •••  output (password value AND an explicitly-masked
    // element's name) matches the canonical walker — so the duplicate can't
    // silently drift on the security-critical masking, not just the diff shape.
    const fixture = `
      <input id="pw" type="password" value="hunter2" aria-label="Password">
      <div data-private><button aria-label="Pay Jane Doe">Send</button></div>
    `;

    // Canonical: build the page (added classification carries every node), then
    // capture the emitted nodes.
    document.body.innerHTML = fixture;
    const canonical = diffPageView({}); // no prior view → everything is `added`

    // Standalone on an identical fresh fixture.
    resetRefGlobals();
    document.body.innerHTML = fixture;
    const standalone = diffPageViewStandalone({});

    // Compare the masked node payloads (name + value) ref-agnostically.
    const payload = (d: PageViewDelta) =>
      d.added.map((n) => `${n.role}|${n.name}|${n.value ?? ''}`).sort();
    expect(payload(standalone)).toEqual(payload(canonical));

    // And assert the actual redaction happened (not just that they agree).
    const pw = standalone.added.find((n) => n.role === 'textbox' && n.value === '•••');
    expect(pw, 'password value → •••').toBeDefined();
    const masked = standalone.added.find((n) => n.name === '•••');
    expect(masked, 'masked region name → •••').toBeDefined();
    expect(JSON.stringify(standalone)).not.toContain('hunter2');
    expect(JSON.stringify(standalone)).not.toContain('Jane Doe');
    expect(JSON.stringify(canonical)).not.toContain('hunter2');
    expect(JSON.stringify(canonical)).not.toContain('Jane Doe');
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

  it('does NOT leak a masked heading through context.heading', () => {
    // The target is NOT itself masked, but its nearest preceding heading sits
    // inside a data-private region — its text must not leak via context.heading.
    document.body.innerHTML = `
      <main>
        <section data-private>
          <h3>Medical Record MRN 884213</h3>
        </section>
        <div id="target" role="region" aria-label="Notes"></div>
      </main>
    `;
    buildPageView({});
    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    let ref = '';
    for (const [r, el] of reg?.entries() ?? []) {
      if (el === document.getElementById('target')) ref = r;
    }
    expect(ref).not.toBe('');
    const detail = buildElementDetail(ref) as ElementDetail;
    // target itself is unmasked (real name), but the masked heading is redacted.
    expect(detail.name).toBe('Notes');
    expect(detail.context?.heading).toBe('•••');
    // the cleartext heading appears nowhere in the serialized detail.
    expect(JSON.stringify(detail)).not.toContain('Medical Record');
    expect(JSON.stringify(detail)).not.toContain('884213');
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

  it('redacts name/value/text/aria/children of a privacy-annotated element to •••', () => {
    // FIX 1 (HIGH): a masked element's free text (name, text, aria values, child
    // names) was returned raw at Level 1. Every page-text field must be •••.
    document.body.innerHTML = `
      <section data-private role="region" aria-label="Patient Jane Doe, DOB 1990-01-02">
        <h3>Diagnosis notes</h3>
        <p>Confidential medical history for Jane Doe</p>
        <input aria-label="SSN" value="123-45-6789">
        <button aria-label="Save Jane Doe record">Save</button>
      </section>
    `;
    buildPageView({}); // role="region" makes the section walkable / registrable
    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    let ref = '';
    for (const [r, el] of reg?.entries() ?? []) {
      if (el === document.querySelector('section[data-private]')) ref = r;
    }
    expect(ref).not.toBe('');
    const detail = buildElementDetail(ref) as ElementDetail;
    expect(detail.ok).toBe(true);
    expect(detail.name).toBe('•••'); // accessible name (aria-label PII) redacted
    expect(detail.text).toBe('•••'); // descendant textContent redacted
    // every aria VALUE redacted (keys preserved).
    for (const [, v] of Object.entries(detail.aria)) expect(v).toBe('•••');
    // every child NAME redacted.
    for (const c of detail.children ?? []) expect(c.name).toBe('•••');
    // The cleartext PII appears NOWHERE in the serialized detail.
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain('Jane Doe');
    expect(serialized).not.toContain('1990-01-02');
    expect(serialized).not.toContain('123-45-6789');
    expect(serialized).not.toContain('Confidential');
  });

  it('redacts a child NAME when only the CHILD (not the parent) is privacy-masked', () => {
    // FIX 1 (HIGH), per-child clause: an UNMASKED container with a masked child
    // must still redact that child's name (isPrivacyMasked applied per child).
    document.body.innerHTML = `
      <div id="panel" role="region" aria-label="Billing">
        <button>Visible Action</button>
        <button class="rr-mask" aria-label="Charge card 4111 1111 1111 1111">Pay</button>
      </div>
    `;
    buildPageView({});
    const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
    let ref = '';
    for (const [r, el] of reg?.entries() ?? []) {
      if (el === document.getElementById('panel')) ref = r;
    }
    const detail = buildElementDetail(ref) as ElementDetail;
    // The parent itself is NOT masked — its own name is intact.
    expect(detail.name).toBe('Billing');
    const names = detail.children?.map((c) => c.name) ?? [];
    expect(names).toContain('Visible Action'); // unmasked child kept
    expect(names).toContain('•••'); // masked child redacted
    expect(JSON.stringify(detail)).not.toContain('4111');
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
