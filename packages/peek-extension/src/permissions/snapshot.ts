/**
 * MAIN-world live page-view snapshot + ref registry (R1 + R2, token-optimization).
 *
 * SECURITY / INJECTION BOUNDARY — read before editing:
 *   • `buildPageView`, `diffPageView`, and `buildElementDetail` are each passed by
 *     reference to `chrome.scripting.executeScript({ world: 'MAIN', func })`, which
 *     serializes ONLY that one function's own source into the page. Each must be
 *     SELF-CONTAINED: no module-scope imports, no closures over outer variables,
 *     no references to a sibling top-level helper (it would be `undefined` in the
 *     page → ReferenceError). Everything each function needs is declared nested or
 *     is a page global (`window`/`document`/`location`/`getComputedStyle`/`CSS`/
 *     `Element`). The R2 helpers (`refState`/`refFor`/`roleOf`/`accName`/
 *     `isSensitiveInput`/`isVisible`) are therefore intentionally DUPLICATED inline
 *     inside each injected function rather than hoisted — this is the R1 pattern and
 *     is guarded by the `.toString()` serialization test.
 *   • None of these functions ever mutate the page or evaluate strings. They read
 *     the DOM. `buildElementDetail` NEVER reads `outerHTML`/`innerHTML` (that would
 *     return raw input values and bypass masking).
 *   • RAW SENSITIVE INPUT VALUES NEVER LEAVE THE PAGE: password/email/tel inputs
 *     and `autocomplete`-sensitive fields emit a `•••` placeholder, mirroring the
 *     recorder's input masking. Accessible NAMES + non-sensitive values are
 *     returned raw and masked SW-side (where `@cubenest/rrweb-core`'s
 *     `maskTextContent` is importable) before anything reaches the AI client.
 *   • The ref registry lives in THREE MAIN-world `window` globals, all JS state
 *     (never DOM mutations, so rrweb never records them):
 *       - `window.__peekRefs`    Map<string, Element>     forward map, rebuilt fresh
 *                                                         each snapshot (only present
 *                                                         refs). KEEPS the R1 name so
 *                                                         `dispatcher.ts` resolution
 *                                                         is unchanged.
 *       - `window.__peekRefByEl` WeakMap<Element, string> identity map; persists
 *                                                         across snapshots so an
 *                                                         element keeps the SAME ref;
 *                                                         auto-GC'd on detach.
 *       - `window.__peekRefSeq`  number                   monotonic counter; persists
 *                                                         across snapshots.
 *     `window.__peekLastView` holds the previous snapshot's node list so `diffPageView`
 *     can compute an in-page delta. All four are wiped when the page navigates (new
 *     context) — a stale `ref` then resolves to null and the dispatcher returns a
 *     `ref expired` error so the agent re-snapshots. Refs are NEVER written as
 *     `data-*` attributes (rrweb would capture those).
 */

/** One element in the page view. `value` present only for safe inputs. */
export interface PageViewNode {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly value?: string;
  readonly state?: string;
}

/** Serializable result of a live page-view snapshot. */
export interface PageViewResult {
  readonly ok: true;
  readonly url: string;
  readonly title: string;
  readonly nodes: PageViewNode[];
  readonly truncated: boolean;
}

/** Serializable delta between the previous snapshot and the current DOM. */
export interface PageViewDelta {
  readonly url: string;
  readonly navigated?: boolean;
  readonly added: PageViewNode[];
  readonly removed: string[]; // refs no longer present
  readonly changed: PageViewNode[];
  readonly truncated: boolean;
}

/** Lossless, structured, single-element drill-in. NO raw outerHTML/innerHTML. */
export interface ElementDetail {
  readonly ok: true;
  readonly ref: string;
  readonly tag: string;
  readonly role: string;
  readonly name: string; // FULL, untruncated (SW masks later)
  readonly value?: string; // sensitive input -> '•••'; else clipped (SW masks)
  readonly type?: string;
  readonly href?: string; // SW path-masks later
  readonly state: string[]; // disabled, checked, expanded=…, selected, required, readonly
  readonly aria: Record<string, string>; // every aria-* attr (SW masks values later)
  readonly rect: { x: number; y: number; w: number; h: number };
  readonly visible: boolean;
  readonly text?: string; // clipped own/descendant textContent (SW masks later)
  readonly context?: { heading?: string; landmark?: string };
  readonly children?: { ref: string; role: string; name: string }[]; // interactive descendants (capped at 20)
  /** Curated, masked computed-style allowlist (SW masks backgroundImage url). */
  readonly computedStyles?: Record<string, string>;
  /** Accessible description (aria-describedby resolution / aria-description), clipped; SW masks. */
  readonly description?: string;
  /** True if this element or any ancestor sets aria-hidden="true". */
  readonly effectiveAriaHidden?: boolean;
  /** True if this element or any ancestor sets aria-disabled="true". */
  readonly effectiveAriaDisabled?: boolean;
}

/** Failure shape shared by the ref-resolving R2 reads. */
export interface ElementDetailError {
  readonly ok: false;
  readonly ref: string;
  readonly error: string;
}

/** The window-global key holding the live ref → Element registry. */
export const PEEK_REF_REGISTRY_KEY = '__peekRefs' as const;

/**
 * Walk the live page and return a compact list of interactive/labeled elements,
 * each with an identity-stable `ref`, populating the MAIN-world ref registry.
 * Self-contained for `executeScript({ world: 'MAIN' })`. Never throws (returns
 * whatever it has).
 */
export function buildPageView(opts: { selector?: string; maxElements?: number }): PageViewResult {
  const max =
    typeof opts?.maxElements === 'number' && opts.maxElements > 0
      ? Math.min(opts.maxElements, 500)
      : 200;

  // --- stable-ref registry (R2) -------------------------------------------
  // Identity-stable refs: an element keeps the SAME ref across snapshots, keyed
  // by a persistent WeakMap (auto-GC'd) + monotonic counter. The forward map
  // (window.__peekRefs, R1 name) is rebuilt fresh each snapshot so a removed
  // element's ref simply isn't present → existing `ref expired` path fires.
  interface RefState {
    byId: Map<string, Element>;
    byEl: WeakMap<Element, string>;
  }
  function refState(): RefState {
    const w = window as unknown as {
      __peekRefs?: Map<string, Element>;
      __peekRefByEl?: WeakMap<Element, string>;
      __peekRefSeq?: number;
    };
    if (!w.__peekRefByEl) w.__peekRefByEl = new WeakMap();
    if (typeof w.__peekRefSeq !== 'number') w.__peekRefSeq = 0;
    const byId = new Map<string, Element>(); // forward map rebuilt fresh each snapshot
    w.__peekRefs = byId;
    return { byId, byEl: w.__peekRefByEl };
  }
  function refFor(el: Element, st: RefState): string {
    let ref = st.byEl.get(el);
    if (!ref) {
      const w = window as unknown as { __peekRefSeq?: number };
      w.__peekRefSeq = (w.__peekRefSeq ?? 0) + 1;
      ref = `e${w.__peekRefSeq}`;
      st.byEl.set(el, ref);
    }
    st.byId.set(ref, el); // present this snapshot
    return ref;
  }
  const st = refState();

  // WHATWG autofill field-name tokens whose value is PII we must NOT emit.
  // Whole-token match (the last token is the field name) so `username` /
  // `country-name` aren't over-masked and `bday` / address / organization aren't
  // missed (a bare substring match got both wrong).
  const SENSITIVE_AUTOFILL = new Set([
    'cc-name',
    'cc-number',
    'cc-exp',
    'cc-exp-month',
    'cc-exp-year',
    'cc-csc',
    'cc-type',
    'new-password',
    'current-password',
    'one-time-code',
    'email',
    'tel',
    'tel-national',
    'tel-local',
    'tel-area-code',
    'tel-extension',
    'bday',
    'bday-day',
    'bday-month',
    'bday-year',
    'name',
    'given-name',
    'additional-name',
    'family-name',
    'honorific-prefix',
    'honorific-suffix',
    'organization',
    'street-address',
    'address-line1',
    'address-line2',
    'address-line3',
    'address-level1',
    'address-level2',
    'address-level3',
    'address-level4',
    'postal-code',
  ]);

  // The privacy-annotation selector a site/user puts on regions to keep content
  // out of recordings: rrweb `.rr-mask`, a generic `data-private`, Datadog's
  // `data-dd-privacy="mask"`, and a peek-specific opt-out. Factored to ONE place
  // per function (reused by isSensitiveInput + isPrivacyMasked) so the two never
  // drift. NOTE: the standalone copy + buildElementDetail carry verbatim copies.
  const MASK_SELECTOR = '.rr-mask, [data-private], [data-dd-privacy="mask"], [data-peek-mask]';

  // True if the element (or any ancestor) is inside an explicitly-masked region.
  // Used to drop NAMES + VALUES — not just input values — so free-text PII inside
  // a `.rr-mask` / `data-private` subtree is masked in-page (defense in depth on
  // top of the SW's maskTextContent).
  function isPrivacyMasked(el: Element): boolean {
    try {
      return !!el.closest(MASK_SELECTOR);
    } catch {
      /* selector unsupported in this env — ignore */
      return false;
    }
  }

  function isSensitiveInput(el: Element): boolean {
    const type = (el as HTMLInputElement).type;
    const t = typeof type === 'string' ? type.toLowerCase() : '';
    if (t === 'password' || t === 'email' || t === 'tel') return true;
    const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase().trim();
    if (ac) {
      const tokens = ac.split(/\s+/);
      const field = tokens[tokens.length - 1] ?? '';
      if (SENSITIVE_AUTOFILL.has(field) || field.startsWith('cc-')) return true;
    }
    // Honor privacy annotations the site/user already uses — drop the value if
    // the field or an ancestor is masked (same selector as isPrivacyMasked).
    if (isPrivacyMasked(el)) return true;
    return false;
  }

  function roleOf(el: Element): string {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const it = (el as HTMLInputElement).type;
      const t = typeof it === 'string' ? it.toLowerCase() : 'text';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      return 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return tag;
  }

  function accName(el: Element): string {
    const aria = el.getAttribute('aria-label');
    if (aria?.trim()) return aria.trim();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
      if (t) return t;
    }
    const id = el.getAttribute('id');
    if (id) {
      try {
        // `CSS.escape` is absent in some non-browser contexts (jsdom) / old
        // webviews — fall back to the raw id (fine for typical ids).
        const esc =
          typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
        const lbl = document.querySelector(`label[for="${esc}"]`);
        if (lbl?.textContent?.trim()) return lbl.textContent.trim();
      } catch {
        /* invalid selector — ignore */
      }
    }
    const closestLabel = el.closest('label');
    if (closestLabel?.textContent?.trim()) return closestLabel.textContent.trim();
    const fallback =
      el.getAttribute('alt') ??
      el.getAttribute('placeholder') ??
      el.getAttribute('title') ??
      el.textContent ??
      '';
    return fallback.trim().replace(/\s+/g, ' ').slice(0, 200);
  }

  function isVisible(el: Element): boolean {
    try {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const cs = getComputedStyle(el as HTMLElement);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    } catch {
      // jsdom without layout: don't drop the node on a missing rect.
      return true;
    }
  }

  let root: ParentNode = document;
  if (opts?.selector) {
    try {
      root = document.querySelector(opts.selector) ?? document;
    } catch {
      root = document;
    }
  }

  const SEL =
    'a[href],button,input,select,textarea,[role],[onclick],[contenteditable=""],[contenteditable="true"],h1,h2,h3,h4,h5,h6';
  let candidates: Element[];
  try {
    candidates = Array.from(root.querySelectorAll(SEL));
  } catch {
    candidates = [];
  }

  const nodes: PageViewNode[] = [];
  let truncated = false;
  for (const el of candidates) {
    if (nodes.length >= max) {
      truncated = true;
      break;
    }
    if (!isVisible(el)) continue;
    const role = roleOf(el);
    // Privacy: an element inside an explicitly-masked region leaks NO free text —
    // its accessible name is replaced with the redaction marker in-page (the
    // value path below is already covered via isSensitiveInput honoring the same
    // selector). This makes the docs' "masked in-page" claim true for names too.
    const masked = isPrivacyMasked(el);
    // Decide noise-filtering on the REAL name FIRST, then mask. Masking before
    // the filter would replace an empty name with '•••' (truthy) and stop
    // unnamed non-controls in a masked region from being filtered out — bloating
    // the snapshot/delta and consuming the maxElements budget with noise.
    const rawName = accName(el);
    const isControl = /^(button|link|textbox|checkbox|radio|combobox)$/.test(role);
    // Skip pure-noise nodes: no name and not an interactive control.
    if (!rawName && !isControl) continue;
    const name = masked ? '•••' : rawName;

    const ref = refFor(el, st);

    const node: { ref: string; role: string; name: string; value?: string; state?: string } = {
      ref,
      role,
      name,
    };

    const rawValue = (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
    if (typeof rawValue === 'string' && role !== 'button') {
      node.value = masked || isSensitiveInput(el) ? '•••' : rawValue.slice(0, 100);
    }

    const stArr: string[] = [];
    if ((el as HTMLInputElement).disabled) stArr.push('disabled');
    if ((el as HTMLInputElement).checked) stArr.push('checked');
    const exp = el.getAttribute('aria-expanded');
    if (exp) stArr.push(`expanded=${exp}`);
    if (stArr.length) node.state = stArr.join(',');

    nodes.push(node);
  }

  // Store the node list so diffPageView can compute an in-page delta next time.
  (window as unknown as { __peekLastView?: PageViewNode[] }).__peekLastView = nodes;

  return { ok: true, url: location.href, title: document.title, nodes, truncated };
}

/**
 * Diff the current DOM against the previous snapshot (window.__peekLastView),
 * returning ONLY what changed. Re-walks via buildPageView (stable refs make the
 * two node lists comparable) and also refreshes __peekLastView.
 *
 * TEST / PARITY ONLY — this is NEVER the injected function. It references the
 * sibling module-level `buildPageView`, so injecting it bare via
 * `executeScript({ func })` would throw `ReferenceError: buildPageView is not
 * defined` in the page. The SW injects {@link diffPageViewStandalone} (which
 * nests its own walker) instead. This canonical version exists so the diff logic
 * is exercised against the canonical walker and a parity test can assert the
 * standalone copy hasn't drifted.
 *
 * The SW only calls the observe diff for NON-navigating actions; navigation is
 * handled SW-side, so this has no navigation branch.
 */
export function diffPageView(opts: { selector?: string; maxElements?: number }): PageViewDelta {
  const prev = (window as unknown as { __peekLastView?: PageViewNode[] }).__peekLastView ?? [];
  const prevByRef = new Map(prev.map((n) => [n.ref, n]));
  const cur = buildPageView(opts); // stable refs make this comparable; also refreshes __peekLastView
  const curByRef = new Map(cur.nodes.map((n) => [n.ref, n]));
  const added = cur.nodes.filter((n) => !prevByRef.has(n.ref));
  const changed = cur.nodes.filter((n) => {
    const p = prevByRef.get(n.ref);
    return (
      !!p && (p.name !== n.name || p.value !== n.value || p.state !== n.state || p.role !== n.role)
    );
  });
  const removed = prev.filter((n) => !curByRef.has(n.ref)).map((n) => n.ref);
  return { url: cur.url, added, removed, changed, truncated: cur.truncated };
}

/**
 * FULLY self-contained diff for `executeScript({ world: 'MAIN', func })` — the
 * function the SW actually injects for the post-action `observe` path.
 *
 * Why this exists separately from {@link diffPageView}: `executeScript({ func })`
 * serializes ONLY the passed function's OWN source. `diffPageView` references the
 * sibling module-level `buildPageView`, so injecting it bare throws
 * `ReferenceError: buildPageView is not defined` in the page. A `new Function`/
 * `eval` wrapper that re-creates `buildPageView` from a string would work in
 * jsdom but is BLOCKED by the page's CSP in MAIN world on any site without
 * `'unsafe-eval'` (MAIN-world injected code runs under the PAGE's CSP) — i.e. it
 * would silently break the diff on most real, hardened sites. So this function
 * nests `buildPageView` as a REAL inner function declaration: no cross-module
 * reference, no runtime code generation, CSP-safe everywhere. The inner walker is
 * a verbatim copy of the exported {@link buildPageView}; the serialization test
 * guards it has no out-of-scope identifiers, and a parity test asserts it matches
 * the canonical walker so the two can't silently drift.
 */
export function diffPageViewStandalone(opts: {
  selector?: string;
  maxElements?: number;
}): PageViewDelta {
  // --- verbatim copy of the exported buildPageView (kept in lockstep; see the
  // parity test in snapshot.test.ts) -------------------------------------------
  function buildPageView(o: { selector?: string; maxElements?: number }): PageViewResult {
    const max =
      typeof o?.maxElements === 'number' && o.maxElements > 0 ? Math.min(o.maxElements, 500) : 200;

    interface RefState {
      byId: Map<string, Element>;
      byEl: WeakMap<Element, string>;
    }
    function refState(): RefState {
      const w = window as unknown as {
        __peekRefs?: Map<string, Element>;
        __peekRefByEl?: WeakMap<Element, string>;
        __peekRefSeq?: number;
      };
      if (!w.__peekRefByEl) w.__peekRefByEl = new WeakMap();
      if (typeof w.__peekRefSeq !== 'number') w.__peekRefSeq = 0;
      const byId = new Map<string, Element>();
      w.__peekRefs = byId;
      return { byId, byEl: w.__peekRefByEl };
    }
    function refFor(el: Element, st: RefState): string {
      let ref = st.byEl.get(el);
      if (!ref) {
        const w = window as unknown as { __peekRefSeq?: number };
        w.__peekRefSeq = (w.__peekRefSeq ?? 0) + 1;
        ref = `e${w.__peekRefSeq}`;
        st.byEl.set(el, ref);
      }
      st.byId.set(ref, el);
      return ref;
    }
    const st = refState();

    const SENSITIVE_AUTOFILL = new Set([
      'cc-name',
      'cc-number',
      'cc-exp',
      'cc-exp-month',
      'cc-exp-year',
      'cc-csc',
      'cc-type',
      'new-password',
      'current-password',
      'one-time-code',
      'email',
      'tel',
      'tel-national',
      'tel-local',
      'tel-area-code',
      'tel-extension',
      'bday',
      'bday-day',
      'bday-month',
      'bday-year',
      'name',
      'given-name',
      'additional-name',
      'family-name',
      'honorific-prefix',
      'honorific-suffix',
      'organization',
      'street-address',
      'address-line1',
      'address-line2',
      'address-line3',
      'address-level1',
      'address-level2',
      'address-level3',
      'address-level4',
      'postal-code',
    ]);

    // Verbatim copy of the canonical buildPageView's privacy selector + helper
    // (kept in lockstep; see the parity test in snapshot.test.ts).
    const MASK_SELECTOR = '.rr-mask, [data-private], [data-dd-privacy="mask"], [data-peek-mask]';
    function isPrivacyMasked(el: Element): boolean {
      try {
        return !!el.closest(MASK_SELECTOR);
      } catch {
        /* selector unsupported in this env — ignore */
        return false;
      }
    }

    function isSensitiveInput(el: Element): boolean {
      const type = (el as HTMLInputElement).type;
      const t = typeof type === 'string' ? type.toLowerCase() : '';
      if (t === 'password' || t === 'email' || t === 'tel') return true;
      const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase().trim();
      if (ac) {
        const tokens = ac.split(/\s+/);
        const field = tokens[tokens.length - 1] ?? '';
        if (SENSITIVE_AUTOFILL.has(field) || field.startsWith('cc-')) return true;
      }
      if (isPrivacyMasked(el)) return true;
      return false;
    }

    function roleOf(el: Element): string {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic';
      if (tag === 'button') return 'button';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input') {
        const it = (el as HTMLInputElement).type;
        const t = typeof it === 'string' ? it.toLowerCase() : 'text';
        if (t === 'checkbox') return 'checkbox';
        if (t === 'radio') return 'radio';
        if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
        return 'textbox';
      }
      if (/^h[1-6]$/.test(tag)) return 'heading';
      return tag;
    }

    function accName(el: Element): string {
      const aria = el.getAttribute('aria-label');
      if (aria?.trim()) return aria.trim();
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const t = labelledby
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (t) return t;
      }
      const id = el.getAttribute('id');
      if (id) {
        try {
          const esc =
            typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
          const lbl = document.querySelector(`label[for="${esc}"]`);
          if (lbl?.textContent?.trim()) return lbl.textContent.trim();
        } catch {
          /* invalid selector — ignore */
        }
      }
      const closestLabel = el.closest('label');
      if (closestLabel?.textContent?.trim()) return closestLabel.textContent.trim();
      const fallback =
        el.getAttribute('alt') ??
        el.getAttribute('placeholder') ??
        el.getAttribute('title') ??
        el.textContent ??
        '';
      return fallback.trim().replace(/\s+/g, ' ').slice(0, 200);
    }

    function isVisible(el: Element): boolean {
      try {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const cs = getComputedStyle(el as HTMLElement);
        return cs.visibility !== 'hidden' && cs.display !== 'none';
      } catch {
        return true;
      }
    }

    let root: ParentNode = document;
    if (o?.selector) {
      try {
        root = document.querySelector(o.selector) ?? document;
      } catch {
        root = document;
      }
    }

    const SEL =
      'a[href],button,input,select,textarea,[role],[onclick],[contenteditable=""],[contenteditable="true"],h1,h2,h3,h4,h5,h6';
    let candidates: Element[];
    try {
      candidates = Array.from(root.querySelectorAll(SEL));
    } catch {
      candidates = [];
    }

    const nodes: PageViewNode[] = [];
    let truncated = false;
    for (const el of candidates) {
      if (nodes.length >= max) {
        truncated = true;
        break;
      }
      if (!isVisible(el)) continue;
      const role = roleOf(el);
      const masked = isPrivacyMasked(el);
      // Noise-filter on the REAL name FIRST, then mask (see buildPageView — a
      // masked '•••' name must not make unnamed non-controls un-filterable).
      const rawName = accName(el);
      const isControl = /^(button|link|textbox|checkbox|radio|combobox)$/.test(role);
      if (!rawName && !isControl) continue;
      const name = masked ? '•••' : rawName;

      const ref = refFor(el, st);

      const node: { ref: string; role: string; name: string; value?: string; state?: string } = {
        ref,
        role,
        name,
      };

      const rawValue = (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
      if (typeof rawValue === 'string' && role !== 'button') {
        node.value = masked || isSensitiveInput(el) ? '•••' : rawValue.slice(0, 100);
      }

      const stArr: string[] = [];
      if ((el as HTMLInputElement).disabled) stArr.push('disabled');
      if ((el as HTMLInputElement).checked) stArr.push('checked');
      const exp = el.getAttribute('aria-expanded');
      if (exp) stArr.push(`expanded=${exp}`);
      if (stArr.length) node.state = stArr.join(',');

      nodes.push(node);
    }

    (window as unknown as { __peekLastView?: PageViewNode[] }).__peekLastView = nodes;

    return { ok: true, url: location.href, title: document.title, nodes, truncated };
  }

  // --- diff logic (identical to diffPageView) ---------------------------------
  const prev = (window as unknown as { __peekLastView?: PageViewNode[] }).__peekLastView ?? [];
  const prevByRef = new Map(prev.map((n) => [n.ref, n]));
  const cur = buildPageView(opts);
  const curByRef = new Map(cur.nodes.map((n) => [n.ref, n]));
  const added = cur.nodes.filter((n) => !prevByRef.has(n.ref));
  const changed = cur.nodes.filter((n) => {
    const p = prevByRef.get(n.ref);
    return (
      !!p && (p.name !== n.name || p.value !== n.value || p.state !== n.state || p.role !== n.role)
    );
  });
  const removed = prev.filter((n) => !curByRef.has(n.ref)).map((n) => n.ref);
  return { url: cur.url, added, removed, changed, truncated: cur.truncated };
}

/**
 * Lossless, structured, masked drill-in for a single element resolved by `ref`.
 * NEVER reads outerHTML/innerHTML (would leak raw input values and bypass
 * masking). Self-contained for `executeScript({ world: 'MAIN' })` — all helpers
 * are nested; reads/extends the live registry globals directly.
 */
export function buildElementDetail(ref: string): ElementDetail | ElementDetailError {
  const reg = (window as unknown as { __peekRefs?: Map<string, Element> }).__peekRefs;
  const el = reg?.get(ref);
  if (!el || !el.isConnected) {
    return { ok: false, ref, error: 'ref expired (re-run get_page_view)' };
  }

  // --- nested, self-contained helpers (duplicated from buildPageView so this
  // function survives standalone MAIN-world serialization) ------------------
  const SENSITIVE_AUTOFILL = new Set([
    'cc-name',
    'cc-number',
    'cc-exp',
    'cc-exp-month',
    'cc-exp-year',
    'cc-csc',
    'cc-type',
    'new-password',
    'current-password',
    'one-time-code',
    'email',
    'tel',
    'tel-national',
    'tel-local',
    'tel-area-code',
    'tel-extension',
    'bday',
    'bday-day',
    'bday-month',
    'bday-year',
    'name',
    'given-name',
    'additional-name',
    'family-name',
    'honorific-prefix',
    'honorific-suffix',
    'organization',
    'street-address',
    'address-line1',
    'address-line2',
    'address-line3',
    'address-level1',
    'address-level2',
    'address-level3',
    'address-level4',
    'postal-code',
  ]);

  // Verbatim copy of buildPageView's privacy selector + helper (kept in lockstep).
  const MASK_SELECTOR = '.rr-mask, [data-private], [data-dd-privacy="mask"], [data-peek-mask]';
  function isPrivacyMasked(node: Element): boolean {
    try {
      return !!node.closest(MASK_SELECTOR);
    } catch {
      /* selector unsupported in this env — ignore */
      return false;
    }
  }

  function isSensitiveInput(node: Element): boolean {
    const type = (node as HTMLInputElement).type;
    const t = typeof type === 'string' ? type.toLowerCase() : '';
    if (t === 'password' || t === 'email' || t === 'tel') return true;
    const ac = (node.getAttribute('autocomplete') ?? '').toLowerCase().trim();
    if (ac) {
      const tokens = ac.split(/\s+/);
      const field = tokens[tokens.length - 1] ?? '';
      if (SENSITIVE_AUTOFILL.has(field) || field.startsWith('cc-')) return true;
    }
    if (isPrivacyMasked(node)) return true;
    return false;
  }

  function roleOf(node: Element): string {
    const explicit = node.getAttribute('role');
    if (explicit) return explicit;
    const tag = node.tagName.toLowerCase();
    if (tag === 'a') return node.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const it = (node as HTMLInputElement).type;
      const t = typeof it === 'string' ? it.toLowerCase() : 'text';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      return 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return tag;
  }

  function accName(node: Element): string {
    const aria = node.getAttribute('aria-label');
    if (aria?.trim()) return aria.trim();
    const labelledby = node.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
      if (t) return t;
    }
    const id = node.getAttribute('id');
    if (id) {
      try {
        const esc =
          typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
        const lbl = document.querySelector(`label[for="${esc}"]`);
        if (lbl?.textContent?.trim()) return lbl.textContent.trim();
      } catch {
        /* invalid selector — ignore */
      }
    }
    const closestLabel = node.closest('label');
    if (closestLabel?.textContent?.trim()) return closestLabel.textContent.trim();
    const fallback =
      node.getAttribute('alt') ??
      node.getAttribute('placeholder') ??
      node.getAttribute('title') ??
      node.textContent ??
      '';
    return fallback.trim().replace(/\s+/g, ' ').slice(0, 200);
  }

  function isVisible(node: Element): boolean {
    try {
      const r = node.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const cs = getComputedStyle(node as HTMLElement);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    } catch {
      return true;
    }
  }

  // Resolve a ref for a child against the LIVE registry (buildElementDetail can
  // be called standalone, so read/extend window.__peekRefs/__peekRefByEl directly).
  function refForLive(node: Element): string {
    const w = window as unknown as {
      __peekRefs?: Map<string, Element>;
      __peekRefByEl?: WeakMap<Element, string>;
      __peekRefSeq?: number;
    };
    if (!w.__peekRefs) w.__peekRefs = new Map<string, Element>();
    if (!w.__peekRefByEl) w.__peekRefByEl = new WeakMap<Element, string>();
    if (typeof w.__peekRefSeq !== 'number') w.__peekRefSeq = 0;
    let r = w.__peekRefByEl.get(node);
    if (!r) {
      w.__peekRefSeq = w.__peekRefSeq + 1;
      r = `e${w.__peekRefSeq}`;
      w.__peekRefByEl.set(node, r);
    }
    w.__peekRefs.set(r, node);
    return r;
  }

  // Privacy: if the resolved element (or an ancestor) is inside an
  // explicitly-masked region, NO free text from it may leave the page — name,
  // value, text, and every aria-* VALUE are replaced with the redaction marker
  // in-page (defense in depth on top of the SW's maskTextContent). This makes
  // the docs' "masked in-page across names/values/text" claim true for the
  // element_detail read, not only input values.
  const masked = isPrivacyMasked(el);
  const tag = el.tagName.toLowerCase();
  const role = roleOf(el);
  const name = masked ? '•••' : accName(el);
  const visible = isVisible(el);

  // rect — guard for jsdom (all-zero is fine).
  let rect = { x: 0, y: 0, w: 0, h: 0 };
  try {
    const r = el.getBoundingClientRect();
    rect = { x: r.x, y: r.y, w: r.width, h: r.height };
  } catch {
    /* no layout — keep zeros */
  }

  // aria — every aria-* attribute (KEYS kept; VALUES redacted when masked, since
  // aria-label/aria-description carry free-text PII just like the name).
  const aria: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith('aria-')) aria[a.name] = masked ? '•••' : a.value;
  }

  // state — disabled / checked / expanded=… / selected / required / readonly.
  const state: string[] = [];
  if ((el as HTMLInputElement).disabled) state.push('disabled');
  if ((el as HTMLInputElement).checked) state.push('checked');
  const exp = el.getAttribute('aria-expanded');
  if (exp) state.push(`expanded=${exp}`);
  if ((el as HTMLOptionElement).selected) state.push('selected');
  if ((el as HTMLInputElement).required) state.push('required');
  if ((el as HTMLInputElement).readOnly) state.push('readonly');

  // --- H2.3 enrichments (all inline; keeps the function MAIN-world-serializable) ---
  // Curated computed-style allowlist — debugging signal without a ~350-property dump.
  const STYLE_KEYS = [
    'display',
    'position',
    'visibility',
    'opacity',
    'zIndex',
    'width',
    'height',
    'margin',
    'padding',
    'border',
    'boxSizing',
    'overflow',
    'color',
    'backgroundColor',
    'backgroundImage',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'textAlign',
  ];
  const cs = getComputedStyle(el);
  const computedStyles: Record<string, string> = {};
  for (const k of STYLE_KEYS) {
    const v = (cs as unknown as Record<string, string>)[k];
    if (typeof v === 'string') computedStyles[k] = v;
  }

  // Accessible description: aria-describedby (id list -> referenced text), else
  // aria-description. Honors the in-page mask: a masked element leaks no free text,
  // and a referenced element inside a masked region is redacted per-reference
  // (mirrors the context.heading precedent below).
  let description: string | undefined;
  if (masked) {
    description = '•••';
  } else {
    const describedby = el.getAttribute('aria-describedby');
    if (describedby) {
      const parts: string[] = [];
      for (const id of describedby.split(/\s+/)) {
        if (!id) continue;
        const refEl = document.getElementById(id);
        if (!refEl) continue;
        if (isPrivacyMasked(refEl)) {
          parts.push('•••');
          continue;
        }
        const t = refEl.textContent?.trim();
        if (t) parts.push(t);
      }
      if (parts.length > 0) description = parts.join(' ');
    }
    if (description === undefined) {
      const ad = el.getAttribute('aria-description');
      if (ad?.trim()) description = ad.trim();
    }
    if (description !== undefined && description.length > 500)
      description = description.slice(0, 500);
  }

  // Effective aria-hidden / aria-disabled (this element or any ancestor).
  let effectiveAriaHidden = false;
  let effectiveAriaDisabled = false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (!effectiveAriaHidden && node.getAttribute('aria-hidden') === 'true')
      effectiveAriaHidden = true;
    if (!effectiveAriaDisabled && node.getAttribute('aria-disabled') === 'true')
      effectiveAriaDisabled = true;
    if (effectiveAriaHidden && effectiveAriaDisabled) break;
  }

  const detail: {
    ok: true;
    ref: string;
    tag: string;
    role: string;
    name: string;
    value?: string;
    type?: string;
    href?: string;
    state: string[];
    aria: Record<string, string>;
    rect: { x: number; y: number; w: number; h: number };
    visible: boolean;
    text?: string;
    context?: { heading?: string; landmark?: string };
    children?: { ref: string; role: string; name: string }[];
    computedStyles: Record<string, string>;
    description?: string;
    effectiveAriaHidden: boolean;
    effectiveAriaDisabled: boolean;
  } = {
    ok: true,
    ref,
    tag,
    role,
    name,
    state,
    aria,
    rect,
    visible,
    computedStyles,
    ...(description !== undefined ? { description } : {}),
    effectiveAriaHidden,
    effectiveAriaDisabled,
  };

  // value — only when present and not a button; sensitive OR masked → '•••'.
  const rawValue = (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  if (typeof rawValue === 'string' && role !== 'button') {
    detail.value = masked || isSensitiveInput(el) ? '•••' : rawValue.slice(0, 200);
  }

  // type (inputs/buttons).
  const typeAttr = el.getAttribute('type');
  if (typeAttr) detail.type = typeAttr;

  // href (links) — SW path-masks later.
  const href = el.getAttribute('href');
  if (href) detail.href = href;

  // text — clipped own/descendant textContent (NOT innerHTML). A masked element's
  // text is the redaction marker (the textContent could be the very PII the
  // mask annotation exists to hide).
  if (masked) {
    detail.text = '•••';
  } else {
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 500);
    if (text) detail.text = text;
  }

  // context — nearest preceding heading + nearest ancestor landmark.
  const context: { heading?: string; landmark?: string } = {};
  // heading: walk previous siblings, then climb ancestors doing the same.
  function headingText(node: Element): string | undefined {
    let cur: Element | null = node;
    while (cur) {
      let sib: Element | null = cur.previousElementSibling;
      while (sib) {
        if (/^h[1-6]$/.test(sib.tagName.toLowerCase())) {
          // A heading inside an explicitly-masked region must not leak its text
          // through the context of a (possibly unmasked) sibling element.
          if (isPrivacyMasked(sib)) return '•••';
          const t = (sib.textContent ?? '').trim().replace(/\s+/g, ' ');
          if (t) return t.slice(0, 200);
        }
        // also check a heading nested at the end of the sibling
        try {
          const nested = sib.querySelector('h1,h2,h3,h4,h5,h6');
          if (nested) {
            if (isPrivacyMasked(nested)) return '•••';
            const t = (nested.textContent ?? '').trim().replace(/\s+/g, ' ');
            if (t) return t.slice(0, 200);
          }
        } catch {
          /* ignore */
        }
        sib = sib.previousElementSibling;
      }
      cur = cur.parentElement;
    }
    return undefined;
  }
  const heading = headingText(el);
  if (heading) context.heading = heading;
  try {
    // nearest ANCESTOR landmark — search from the parent so el's own role
    // doesn't count as its own landmark context.
    const landmark = el.parentElement?.closest('[role], main, nav, header, footer, aside');
    if (landmark) {
      const lr = landmark.getAttribute('role');
      context.landmark = lr ?? landmark.tagName.toLowerCase();
    }
  } catch {
    /* selector unsupported — ignore */
  }
  if (context.heading !== undefined || context.landmark !== undefined) {
    detail.context = context;
  }

  // children — interactive descendants (capped at 20). Each child's NAME is
  // redacted if the parent is masked OR the child is itself inside a masked
  // region (per-child check — a masked subtree under an unmasked parent must
  // still redact, and the whole-element mask above covers the inverse).
  const SEL =
    'a[href],button,input,select,textarea,[role],[onclick],[contenteditable=""],[contenteditable="true"],h1,h2,h3,h4,h5,h6';
  const children: { ref: string; role: string; name: string }[] = [];
  let kids: Element[] = [];
  try {
    kids = Array.from(el.querySelectorAll(SEL));
  } catch {
    kids = [];
  }
  for (const kid of kids) {
    if (children.length >= 20) break;
    if (!isVisible(kid)) continue;
    const kidMasked = masked || isPrivacyMasked(kid);
    children.push({
      ref: refForLive(kid),
      role: roleOf(kid),
      name: kidMasked ? '•••' : accName(kid),
    });
  }
  if (children.length) detail.children = children;

  return detail;
}
