/**
 * MAIN-world live page-view snapshot + ref registry (R1, token-optimization).
 *
 * SECURITY / INJECTION BOUNDARY — read before editing:
 *   • `buildPageView` is passed by reference to
 *     `chrome.scripting.executeScript({ world: 'MAIN', func: buildPageView })`,
 *     which serializes ONLY this function's own source into the page. It must be
 *     SELF-CONTAINED: no module-scope imports, no closures over outer variables
 *     (a module-scope helper would be `undefined` in the page → ReferenceError).
 *     Everything it needs is declared nested or is a page global
 *     (`window`/`document`/`location`/`getComputedStyle`/`CSS`).
 *   • It NEVER mutates the page and NEVER evaluates strings. It reads the DOM.
 *   • RAW SENSITIVE INPUT VALUES NEVER LEAVE THE PAGE: password/email/tel inputs
 *     and `autocomplete`-sensitive fields emit a `•••` placeholder, mirroring the
 *     recorder's input masking. Accessible NAMES + non-sensitive values are
 *     returned raw and masked SW-side (where `@cubenest/rrweb-core`'s
 *     `maskTextContent` is importable) before anything reaches the AI client.
 *   • The ref registry is a MAIN-world `window` global (`window.__peekRefs`). It
 *     is JS state, NOT a DOM mutation, so rrweb never records it. It survives
 *     between separate `executeScript` injections in the same page context and is
 *     wiped when the page navigates (new context) — a stale `ref` then resolves
 *     to null and the dispatcher returns a `ref expired` error so the agent
 *     re-snapshots. Refs are NEVER written as `data-*` attributes (rrweb would
 *     capture those).
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

/** The window-global key holding the live ref → Element registry. */
export const PEEK_REF_REGISTRY_KEY = '__peekRefs' as const;

/**
 * Walk the live page and return a compact list of interactive/labeled elements,
 * each with a stable `ref`, populating the MAIN-world ref registry. Self-contained
 * for `executeScript({ world: 'MAIN' })`. Never throws (returns whatever it has).
 */
export function buildPageView(opts: { selector?: string; maxElements?: number }): PageViewResult {
  const max =
    typeof opts?.maxElements === 'number' && opts.maxElements > 0
      ? Math.min(opts.maxElements, 500)
      : 200;

  // (Re)create the per-snapshot registry as a MAIN-world global. Replacing the
  // Map releases the previous snapshot's element references. Invisible to rrweb.
  const reg = new Map<string, Element>();
  (window as unknown as Record<string, unknown>).__peekRefs = reg;

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
    // Honor privacy annotations the site/user already uses to keep content out of
    // recordings (rrweb `.rr-mask`, Datadog, a generic `data-private`, and a
    // peek-specific opt-out) — drop the value if the field or an ancestor is masked.
    try {
      if (el.closest('.rr-mask, [data-private], [data-dd-privacy="mask"], [data-peek-mask]')) {
        return true;
      }
    } catch {
      /* selector unsupported in this env — ignore */
    }
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
  let counter = 0;
  let truncated = false;
  for (const el of candidates) {
    if (nodes.length >= max) {
      truncated = true;
      break;
    }
    if (!isVisible(el)) continue;
    const role = roleOf(el);
    const name = accName(el);
    const isControl = /^(button|link|textbox|checkbox|radio|combobox)$/.test(role);
    // Skip pure-noise nodes: no name and not an interactive control.
    if (!name && !isControl) continue;

    const ref = `e${++counter}`;
    reg.set(ref, el);

    const node: { ref: string; role: string; name: string; value?: string; state?: string } = {
      ref,
      role,
      name,
    };

    const rawValue = (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
    if (typeof rawValue === 'string' && role !== 'button') {
      node.value = isSensitiveInput(el) ? '•••' : rawValue.slice(0, 100);
    }

    const st: string[] = [];
    if ((el as HTMLInputElement).disabled) st.push('disabled');
    if ((el as HTMLInputElement).checked) st.push('checked');
    const exp = el.getAttribute('aria-expanded');
    if (exp) st.push(`expanded=${exp}`);
    if (st.length) node.state = st.join(',');

    nodes.push(node);
  }

  return { ok: true, url: location.href, title: document.title, nodes, truncated };
}
