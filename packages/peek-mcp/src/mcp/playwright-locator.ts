// Derive a semantic Playwright locator for a serialized rrweb node. Prefers
// the most resilient locator strategy in priority order:
//   1. getByTestId   — data-testid is the most stable automation hook
//   2. getByRole     — ARIA role + accessible name (user-visible, semantic)
//   3. getByPlaceholder — for input/textarea with placeholder text
//   4. getByText     — visible text match (unique across snapshot)
//   5. page.locator  — CSS selector fallback via selectorFor
//
// All strategies require uniqueness within the snapshot — if two nodes share
// the same locator expression, we fall through to the next strategy.

import { NodeType, type serializedNodeWithId } from './rrweb-types.js';
import { type NodeIndex, attributes, selectorFor, strAttr, tagName } from './selector.js';

const MAX_TEXT = 80;

/** Single-quote JS string literal, escaping backslashes and quotes. */
function js(value: string): string {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}'`;
}

/**
 * Return the implicit ARIA role for a serialized element node, or `undefined`
 * if the node has no meaningful role (non-element, or element with no
 * applicable mapping). Respects an explicit `role` attribute first.
 */
export function implicitRole(node: serializedNodeWithId): string | undefined {
  const tag = tagName(node);
  if (tag === undefined) return undefined;
  const attrs = attributes(node);
  const explicit = strAttr(attrs, 'role');
  if (explicit !== undefined) return explicit;
  switch (tag) {
    case 'button':
      return 'button';
    case 'a':
      return strAttr(attrs, 'href') !== undefined ? 'link' : undefined;
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    case 'input': {
      const type = (strAttr(attrs, 'type') ?? 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image')
        return 'button';
      if (type === 'hidden' || type === 'file') return undefined;
      return 'textbox';
    }
    default:
      return undefined;
  }
}

/**
 * Collect all visible text content from a serialized node's subtree, skipping
 * `<script>` and `<style>` elements. Collapses whitespace and trims.
 */
export function visibleText(node: serializedNodeWithId): string {
  const parts: string[] = [];
  const walk = (n: serializedNodeWithId): void => {
    if (n.type === NodeType.Text) {
      const t = (n as { textContent?: string }).textContent;
      if (t) parts.push(t);
      return;
    }
    if (n.type === NodeType.Element) {
      const tag = tagName(n);
      if (tag === 'script' || tag === 'style') return;
    }
    for (const c of (n as { childNodes?: serializedNodeWithId[] }).childNodes ?? []) walk(c);
  };
  walk(node);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * Return the accessible name for a node:
 *   - `aria-label` beats everything
 *   - For button/link roles, use visible text content
 *   - Otherwise undefined (the element doesn't have a useful accessible name
 *     for locator purposes)
 */
export function accessibleName(node: serializedNodeWithId): string | undefined {
  const aria = strAttr(attributes(node), 'aria-label');
  if (aria !== undefined) return aria;
  const role = implicitRole(node);
  if (role === 'button' || role === 'link') {
    const t = visibleText(node);
    return t.length > 0 ? t : undefined;
  }
  return undefined;
}

/**
 * True iff exactly one node in the index satisfies `pred`. Used to enforce
 * uniqueness before emitting a getBy* locator — a locator that matches
 * multiple elements would be ambiguous in a real Playwright script.
 */
function uniqueBy(index: NodeIndex, pred: (n: serializedNodeWithId) => boolean): boolean {
  let count = 0;
  for (const { node } of index.values()) {
    if (pred(node)) {
      count += 1;
      if (count > 1) return false;
    }
  }
  return count === 1;
}

/**
 * Derive a Playwright locator string for a serialized node by its rrweb id.
 *
 * Returns `undefined` if the id is absent from the index AND the CSS fallback
 * also cannot produce a selector (which is itself extremely rare — it means
 * the id truly doesn't exist in the snapshot).
 */
export function playwrightLocator(index: NodeIndex, id: number): string | undefined {
  const cssFallback = (): string | undefined => {
    const css = selectorFor(index, id);
    return css !== undefined ? `page.locator(${js(css)})` : undefined;
  };
  const entry = index.get(id);
  if (!entry) return cssFallback();
  const node = entry.node;
  const attrs = attributes(node);
  const tag = tagName(node);

  // 1. data-testid — most stable automation hook
  const testId = strAttr(attrs, 'data-testid');
  if (
    testId !== undefined &&
    uniqueBy(index, (n) => strAttr(attributes(n), 'data-testid') === testId)
  ) {
    return `page.getByTestId(${js(testId)})`;
  }

  // 2. ARIA role + accessible name
  const role = implicitRole(node);
  const name = accessibleName(node);
  if (
    role !== undefined &&
    name !== undefined &&
    uniqueBy(index, (n) => implicitRole(n) === role && accessibleName(n) === name)
  ) {
    return `page.getByRole(${js(role)}, { name: ${js(name)} })`;
  }

  // 3. placeholder (inputs / textareas)
  const placeholder = strAttr(attrs, 'placeholder');
  if (
    placeholder !== undefined &&
    (tag === 'input' || tag === 'textarea') &&
    uniqueBy(index, (n) => strAttr(attributes(n), 'placeholder') === placeholder)
  ) {
    return `page.getByPlaceholder(${js(placeholder)})`;
  }

  // 4. visible text (exact, unique, not too long)
  const t = visibleText(node);
  if (
    t.length > 0 &&
    t.length <= MAX_TEXT &&
    uniqueBy(index, (n) => n.type === NodeType.Element && visibleText(n) === t)
  ) {
    return `page.getByText(${js(t)}, { exact: true })`;
  }

  // 5. CSS selector fallback
  return cssFallback();
}
