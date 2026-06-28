// Derive a human/agent-readable CSS selector for an rrweb node id from a
// serialized snapshot tree. rrweb records interactions by numeric node id; to
// turn "click on id 42" into something an agent (or a Playwright script) can
// use, we walk the serialized DOM the id refers to and synthesize a selector,
// preferring stable hooks (#id, [data-testid], unique tag.class) and falling
// back to an `nth-of-type` path.
//
// This operates purely on the serialized node tree (no live DOM), so it works
// in plain Node — the same constraint the rest of the event walker honors.

import { NodeType, type serializedNodeWithId } from './rrweb-types.js';

/** A serialized node plus its resolved parent, for ancestor walks. */
interface IndexedNode {
  readonly node: serializedNodeWithId;
  readonly parentId: number | null;
}

/**
 * A flat index of a serialized snapshot tree: node id -> { node, parentId }.
 * Built once per snapshot so selector derivation and DOM lookups are O(1) per
 * id instead of re-walking the tree.
 */
export type NodeIndex = ReadonlyMap<number, IndexedNode>;

/**
 * Max DOM nesting depth the offline walkers descend before stopping. Real
 * browser DOMs are nowhere near this deep; the bound exists because this code
 * ingests UNTRUSTED recordings — a crafted ~10k-deep tree would otherwise blow
 * the call stack. Shared so the index builders and the serializer agree.
 */
export const MAX_DOM_DEPTH = 1000;

/**
 * Build a {@link NodeIndex} from a FullSnapshot's root serialized node. Nodes
 * deeper than {@link MAX_DOM_DEPTH} are skipped (not indexed) rather than
 * overflowing the stack on an adversarial blob.
 */
export function indexNodes(root: serializedNodeWithId): NodeIndex {
  const index = new Map<number, IndexedNode>();
  const walk = (node: serializedNodeWithId, parentId: number | null, depth: number): void => {
    index.set(node.id, { node, parentId });
    if (depth >= MAX_DOM_DEPTH) return;
    for (const child of nodeChildren(node)) {
      walk(child, node.id, depth + 1);
    }
  };
  walk(root, null, 0);
  return index;
}

/** The serialized child nodes of a node, or `[]` for leaf/text/comment nodes. */
export function nodeChildren(node: serializedNodeWithId): serializedNodeWithId[] {
  if (node.type === NodeType.Document || node.type === NodeType.Element) {
    // documentNode + elementNode both carry `childNodes`.
    return (node as { childNodes?: serializedNodeWithId[] }).childNodes ?? [];
  }
  return [];
}

export function tagName(node: serializedNodeWithId): string | undefined {
  if (node.type === NodeType.Element) {
    return (node as { tagName: string }).tagName.toLowerCase();
  }
  return undefined;
}

export function attributes(node: serializedNodeWithId): Record<string, unknown> {
  if (node.type === NodeType.Element) {
    return (node as { attributes?: Record<string, unknown> }).attributes ?? {};
  }
  return {};
}

/** A non-empty string attribute value, or undefined. */
export function strAttr(attrs: Record<string, unknown>, key: string): string | undefined {
  const v = attrs[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** CSS-escape an id/class token (only the characters that actually break a selector). */
function cssEscape(token: string): string {
  // A conservative escape: backslash-escape characters that aren't valid in an
  // unescaped CSS identifier. Good enough for selectors emitted into JSON / a
  // Playwright string; not a full CSS.escape polyfill.
  return token.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/**
 * Derive the most stable selector for a single node, ignoring ancestors:
 *   1. `#id`                (when the id looks static, not an obvious nonce)
 *   2. `[data-testid="…"]`  (or data-test / data-cy — test hooks)
 *   3. `tag[name="…"]`      (form controls)
 *   4. `tag.class.class`    (first two classes)
 *   5. `tag`
 * Returns `undefined` for non-element nodes.
 */
export function localSelector(node: serializedNodeWithId): string | undefined {
  const tag = tagName(node);
  if (tag === undefined) return undefined;
  const attrs = attributes(node);

  const id = strAttr(attrs, 'id');
  if (id !== undefined && isStableToken(id)) {
    return `#${cssEscape(id)}`;
  }

  for (const hook of ['data-testid', 'data-test', 'data-cy']) {
    const v = strAttr(attrs, hook);
    if (v !== undefined) return `[${hook}="${cssAttrValue(v)}"]`;
  }

  const name = strAttr(attrs, 'name');
  if (name !== undefined && (tag === 'input' || tag === 'select' || tag === 'textarea')) {
    return `${tag}[name="${cssAttrValue(name)}"]`;
  }

  const ariaLabel = strAttr(attrs, 'aria-label');
  if (ariaLabel !== undefined) {
    return `[aria-label="${cssAttrValue(ariaLabel)}"]`;
  }

  const placeholder = strAttr(attrs, 'placeholder');
  if (placeholder !== undefined && (tag === 'input' || tag === 'textarea')) {
    return `${tag}[placeholder="${cssAttrValue(placeholder)}"]`;
  }

  const className = strAttr(attrs, 'class');
  if (className !== undefined) {
    const classes = className
      .trim()
      .split(/\s+/)
      .filter((c) => isStableToken(c))
      .slice(0, 2)
      .map((c) => `.${cssEscape(c)}`)
      .join('');
    if (classes.length > 0) return `${tag}${classes}`;
  }

  return tag;
}

/** Escape a double-quoted CSS attribute value. */
export function cssAttrValue(value: string): string {
  return value.replace(/["\\]/g, (ch) => `\\${ch}`);
}

/**
 * Heuristic: does a token look like a stable hook rather than a generated
 * nonce? Rejects hashed/utility tokens (long hex-ish runs, CSS-module suffixes
 * like `Button_x8Hk2`, emotion `css-1q2w3e`). Keeps short, word-y identifiers.
 */
export function isStableToken(token: string): boolean {
  if (token.length === 0 || token.length > 40) return false;
  // emotion / styled-components generated classes. Thresholds kept low so short
  // generated suffixes (e.g. `css-abc`, `sc-aBcd`) are rejected too.
  if (/^css-[a-z0-9]{3,}$/i.test(token)) return false;
  if (/^sc-[a-zA-Z0-9]{4,}$/.test(token)) return false;
  // CSS-modules `Name_hash` / `Name__hash` suffixes.
  if (/_{1,2}[a-zA-Z0-9]{5,}$/.test(token)) return false;
  // A long run that's mostly hex digits → likely a content hash.
  if (token.length >= 8 && /^[a-f0-9-]+$/i.test(token) && /[0-9]/.test(token)) return false;
  return true;
}

/**
 * The index of `node` among its same-tag siblings (1-based, for
 * `:nth-of-type`). Returns 1 when the parent is unknown or there are no
 * siblings to disambiguate.
 */
function nthOfType(index: NodeIndex, id: number): number {
  const entry = index.get(id);
  if (!entry || entry.parentId === null) return 1;
  const parent = index.get(entry.parentId);
  if (!parent) return 1;
  const tag = tagName(entry.node);
  if (tag === undefined) return 1;
  let n = 0;
  for (const sibling of nodeChildren(parent.node)) {
    if (tagName(sibling) === tag) {
      n += 1;
      if (sibling.id === id) return n;
    }
  }
  return Math.max(n, 1);
}

/**
 * Derive a full selector path for `id` within `index`, climbing ancestors until
 * an id/test-hook anchor is hit (or the document root). Joins with `>` to keep
 * the path specific and short. Returns `undefined` if `id` is missing or not an
 * element. The result is a best-effort selector for human/agent consumption and
 * Playwright scripts — not guaranteed unique on a live page, but stable enough
 * for the recorded snapshot.
 */
function selectorForUncached(index: NodeIndex, id: number): string | undefined {
  const start = index.get(id);
  if (!start || tagName(start.node) === undefined) return undefined;

  const segments: string[] = [];
  let currentId: number | null = id;
  let depth = 0;
  while (currentId !== null && depth < 12) {
    const entry: IndexedNode | undefined = index.get(currentId);
    if (!entry) break;
    const tag = tagName(entry.node);
    if (tag === undefined) break; // reached the document node

    const local = localSelector(entry.node);
    if (local === undefined) break;

    // `body`/`html` are unique document-structure anchors — including them adds
    // no specificity and just lengthens the selector, so stop the climb there
    // (the segment so far is rooted at body, which is what an agent wants).
    if (tag === 'body' || tag === 'html') break;

    // `aria-label`/`placeholder` are readable but NOT guaranteed unique, so they
    // must keep climbing for ancestor + nth-of-type disambiguation. Only the
    // genuinely-unique hooks (#id, [data-*], tag[name]) terminate the climb. Key
    // off the FIRST attribute name (not a substring of the rendered segment) so
    // an attribute *value* that happens to contain `[aria-label=` — possible in
    // an untrusted recording — can't be mistaken for a soft attribute.
    const firstAttr = local.match(/\[([a-zA-Z-]+)[=\]]/)?.[1];
    const isSoftAttr = firstAttr === 'aria-label' || firstAttr === 'placeholder';
    const isAnchor = !isSoftAttr && (local.startsWith('#') || local.includes('['));
    if (isAnchor) {
      segments.unshift(local);
      break;
    }

    // Disambiguate a bare/`.class` segment with nth-of-type when it has same-tag
    // siblings.
    const n = nthOfType(index, currentId);
    segments.unshift(n > 1 ? `${local}:nth-of-type(${n})` : local);

    currentId = entry.parentId;
    depth += 1;
  }

  if (segments.length === 0) return undefined;
  return segments.join(' > ');
}

/**
 * Resolve a stable CSS selector for a node id. Pass a per-NodeIndex `cache`
 * (Map<id, selector>) to memoize across the O(nodes) callsite loops — the result
 * is pure for a given (index, id), so the cache is safe only while it shares the
 * index's lifetime (create a fresh cache whenever the index is rebuilt).
 */
export function selectorFor(
  index: NodeIndex,
  id: number,
  cache?: Map<number, string | undefined>,
): string | undefined {
  if (cache?.has(id) === true) return cache.get(id);
  const result = selectorForUncached(index, id);
  if (cache !== undefined) cache.set(id, result);
  return result;
}
