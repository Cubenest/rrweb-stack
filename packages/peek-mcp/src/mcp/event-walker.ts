// The shared rrweb stream walker — the heart of the event-level read tools.
//
// rrweb records a session as a FullSnapshot (the serialized DOM at capture
// start) followed by IncrementalSnapshot events (mutations, mouse interactions,
// input edits) and Meta events (navigations). To answer the MCP read tools we
// decode that stream once and offer three views over it:
//
//   • user actions      — clicks / inputs / navigations with timestamps +
//                          derived selectors (get_user_action_before_error,
//                          generate_playwright_repro).
//   • DOM at a timestamp — the FullSnapshot's serialized tree with structural +
//                          attribute + text mutations applied up to T, rendered
//                          to an HTML-ish string (get_dom_snapshot). v1 scope:
//                          see reconstructDomAt's doc.
//   • selector history   — the timeline of attribute / text changes for a node
//                          matched by selector (query_dom_history).
//
// Everything works on the decoded `eventWithTime[]` with no live DOM, so it
// runs in plain Node (no jsdom) — matching ADR-0011's "thin local client".

import {
  EventType,
  IncrementalSource,
  MouseInteractions,
  NodeType,
  type addedNodeMutation,
  type attributeMutation,
  type eventWithTime,
  type inputData,
  type metaEvent,
  type mouseInteractionData,
  type mutationData,
  type serializedNodeWithId,
  type textMutation,
} from './rrweb-types.js';
import {
  MAX_DOM_DEPTH,
  type NodeIndex,
  indexNodes,
  nodeChildren,
  selectorFor,
} from './selector.js';

/** A single extracted user action with the data a repro / explanation needs. */
export interface UserAction {
  /** 'click' | 'input' | 'navigate' | 'submit' (a click on a submit control). */
  readonly type: 'click' | 'input' | 'navigate';
  /** Epoch-millis of the action (the event's `timestamp`). */
  readonly ts: number;
  /** Derived CSS selector for the target node, when resolvable. */
  readonly selector?: string;
  /** For input actions: the (already-masked-by-capture) value typed. */
  readonly value?: string;
  /** For navigations: the destination URL (Meta event href). */
  readonly url?: string;
  /** A short human description, e.g. `click button.submit`. */
  readonly summary: string;
}

/** A serialized node mutated in place during DOM reconstruction. */
type MutableNode = serializedNodeWithId & {
  childNodes?: serializedNodeWithId[];
  attributes?: Record<string, unknown>;
  textContent?: string;
};

function isFullSnapshot(
  e: eventWithTime,
): e is eventWithTime & { type: EventType.FullSnapshot; data: { node: serializedNodeWithId } } {
  return e.type === EventType.FullSnapshot;
}

function isIncremental(e: eventWithTime): e is eventWithTime & { data: { source: number } } {
  return e.type === EventType.IncrementalSnapshot;
}

function isMeta(e: eventWithTime): e is metaEvent & { timestamp: number } {
  return e.type === EventType.Meta;
}

/**
 * Walk the stream and pull out user actions (clicks, input commits, page
 * navigations) in chronological order. The selector for a click/input is
 * derived from whichever FullSnapshot is in effect at that point (rebuilt as
 * new FullSnapshots arrive), with added nodes folded into the index so
 * interactions on dynamically-inserted elements still resolve.
 *
 * Mouse *moves*, scrolls, and non-Click interactions are intentionally dropped
 * — they're noise for repro/explanation and blow the token budget.
 */
export function extractUserActions(events: eventWithTime[]): UserAction[] {
  const actions: UserAction[] = [];
  // The live node index, seeded by the latest FullSnapshot and grown by adds.
  let index: Map<number, { node: serializedNodeWithId; parentId: number | null }> | undefined;

  const resolveSelector = (id: number): string | undefined =>
    index ? selectorFor(index as NodeIndex, id) : undefined;

  for (const e of events) {
    if (isFullSnapshot(e)) {
      index = new Map(indexNodes(e.data.node));
      continue;
    }

    if (isMeta(e)) {
      const href = e.data.href;
      if (typeof href === 'string' && href.length > 0) {
        actions.push({ type: 'navigate', ts: e.timestamp, url: href, summary: `navigate ${href}` });
      }
      continue;
    }

    if (!isIncremental(e)) continue;
    const data = e.data as { source: number };

    if (data.source === IncrementalSource.Mutation) {
      // Keep the index current so interactions on inserted nodes resolve.
      foldAddsIntoIndex(index, (data as unknown as mutationData).adds);
      continue;
    }

    if (data.source === IncrementalSource.MouseInteraction) {
      const mi = data as unknown as mouseInteractionData;
      if (mi.type === MouseInteractions.Click || mi.type === MouseInteractions.DblClick) {
        const selector = resolveSelector(mi.id);
        actions.push({
          type: 'click',
          ts: e.timestamp,
          ...(selector !== undefined ? { selector } : {}),
          summary: selector !== undefined ? `click ${selector}` : `click node#${mi.id}`,
        });
      }
      continue;
    }

    if (data.source === IncrementalSource.Input) {
      const input = data as unknown as inputData;
      const selector = resolveSelector(input.id);
      // rrweb already masks values per the recorder config; we surface as-is.
      const value = typeof input.text === 'string' ? input.text : '';
      actions.push({
        type: 'input',
        ts: e.timestamp,
        ...(selector !== undefined ? { selector } : {}),
        value,
        summary:
          selector !== undefined
            ? `input ${selector} = ${truncate(value, 40)}`
            : `input node#${input.id} = ${truncate(value, 40)}`,
      });
    }
  }

  return actions;
}

/** Fold a mutation's added nodes into the live index (best-effort, recursive). */
function foldAddsIntoIndex(
  index: Map<number, { node: serializedNodeWithId; parentId: number | null }> | undefined,
  adds: addedNodeMutation[] | undefined,
): void {
  if (!index || !adds) return;
  for (const add of adds) {
    const register = (node: serializedNodeWithId, parentId: number | null, depth: number): void => {
      index.set(node.id, { node, parentId });
      if (depth >= MAX_DOM_DEPTH) return;
      for (const child of nodeChildren(node)) register(child, node.id, depth + 1);
    };
    register(add.node, add.parentId, 0);
  }
}

/** The user actions strictly before `errorTs`, most-recent-last, capped to `window`. */
export function userActionsBeforeError(
  events: eventWithTime[],
  errorTs: number,
  window = 10,
): UserAction[] {
  const all = extractUserActions(events).filter((a) => a.ts <= errorTs);
  return all.slice(Math.max(0, all.length - window));
}

/**
 * Reconstruct the DOM at timestamp `ts` and render it to an HTML-ish string.
 *
 * v1 scope (deliberately bounded — see the task's "don't rabbit-hole" note):
 * start from the most recent FullSnapshot at or before `ts`, then replay
 * IncrementalSnapshot **mutations** (node adds/removes, attribute changes, text
 * changes) up to and including `ts`. We do NOT run rrweb's Replayer/jsdom; we
 * mutate the serialized tree directly and serialize it back. This faithfully
 * reflects structural/attribute/text state at T — which is what the read tools
 * need — while skipping canvas/media/stylesheet replay (not needed for DOM
 * inspection and out of budget). The offset from the base snapshot is reported
 * so a caller knows how much was applied.
 *
 * Returns `undefined` if there is no FullSnapshot at or before `ts`.
 */
export interface DomSnapshot {
  /** Epoch-millis of the FullSnapshot the reconstruction started from. */
  readonly baseSnapshotTs: number;
  /** Number of mutation events applied on top of the base snapshot. */
  readonly mutationsApplied: number;
  /** The serialized (and mutated) document/element subtree. */
  readonly root: serializedNodeWithId;
  /** The rendered HTML-ish string (optionally scoped to a selector subtree). */
  readonly html: string;
}

export function reconstructDomAt(
  events: eventWithTime[],
  ts: number,
  selector?: string,
): DomSnapshot | undefined {
  // Find the base FullSnapshot (latest at or before ts).
  let baseIdx = -1;
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e && isFullSnapshot(e) && e.timestamp <= ts) baseIdx = i;
  }
  if (baseIdx < 0) return undefined;
  const baseEvent = events[baseIdx] as eventWithTime & {
    type: EventType.FullSnapshot;
    data: { node: serializedNodeWithId };
  };

  // Deep clone so we can mutate without touching the caller's events. Use a
  // depth-bounded clone (not structuredClone, which recurses and overflows the
  // stack on an adversarial deeply-nested tree before any of our guards run).
  const root = cloneNodeBounded(baseEvent.data.node, 0);
  const byId = new Map<number, MutableNode>();
  const parentOf = new Map<number, number>();
  (function indexMutable(node: MutableNode, parentId: number | null, depth: number): void {
    byId.set(node.id, node);
    if (parentId !== null) parentOf.set(node.id, parentId);
    if (depth >= MAX_DOM_DEPTH) return;
    for (const child of nodeChildren(node)) indexMutable(child as MutableNode, node.id, depth + 1);
  })(root, null, 0);

  let mutationsApplied = 0;
  for (let i = baseIdx + 1; i < events.length; i += 1) {
    const e = events[i];
    if (!e || e.timestamp > ts) break;
    if (!isIncremental(e)) continue;
    const data = e.data as { source: number };
    if (data.source !== IncrementalSource.Mutation) continue;
    applyMutation(data as unknown as mutationData, byId, parentOf);
    mutationsApplied += 1;
  }

  // Optionally scope to the first node matching `selector`.
  let renderRoot: MutableNode = root;
  if (selector !== undefined) {
    const match = findBySelector(root, byId, selector);
    if (match) renderRoot = match;
  }

  return {
    baseSnapshotTs: baseEvent.timestamp,
    mutationsApplied,
    root: renderRoot,
    html: serializeNode(renderRoot),
  };
}

/**
 * Depth-bounded deep clone of a serialized node. Stops cloning children past
 * {@link MAX_DOM_DEPTH} (the truncated node keeps its own scalar fields but
 * loses descendants), so it never overflows the stack on an adversarial
 * deeply-nested subtree — unlike `structuredClone`, which recurses internally.
 * Attribute objects are shallow-copied (flat string maps, never nested).
 */
function cloneNodeBounded(node: serializedNodeWithId, depth: number): MutableNode {
  const src = node as MutableNode;
  const clone: MutableNode = { ...src };
  if (src.attributes) clone.attributes = { ...src.attributes };
  const children = nodeChildren(node);
  if (children.length > 0) {
    clone.childNodes =
      depth >= MAX_DOM_DEPTH ? [] : children.map((c) => cloneNodeBounded(c, depth + 1));
  }
  return clone;
}

/** Apply a single mutation event to the in-memory serialized tree. */
function applyMutation(
  m: mutationData,
  byId: Map<number, MutableNode>,
  parentOf: Map<number, number>,
): void {
  // Removes first (rrweb applies removes, then adds, then attrs/texts).
  for (const r of m.removes ?? []) {
    const parent = byId.get(r.parentId);
    if (parent && Array.isArray(parent.childNodes)) {
      parent.childNodes = parent.childNodes.filter((c) => c.id !== r.id);
    }
    byId.delete(r.id);
    parentOf.delete(r.id);
  }

  for (const a of m.adds ?? []) {
    const parent = byId.get(a.parentId);
    if (!parent) continue;
    if (!Array.isArray(parent.childNodes)) parent.childNodes = [];
    const clone = cloneNodeBounded(a.node, 0);
    // Insert before `nextId` when present, else append.
    if (a.nextId !== null && a.nextId !== undefined) {
      const at = parent.childNodes.findIndex((c) => c.id === a.nextId);
      if (at >= 0) parent.childNodes.splice(at, 0, clone);
      else parent.childNodes.push(clone);
    } else {
      parent.childNodes.push(clone);
    }
    // Register the added subtree (depth-bounded against adversarial nesting).
    (function register(node: MutableNode, parentId: number, depth: number): void {
      byId.set(node.id, node);
      parentOf.set(node.id, parentId);
      if (depth >= MAX_DOM_DEPTH) return;
      for (const child of nodeChildren(node)) register(child as MutableNode, node.id, depth + 1);
    })(clone, parent.id, 0);
  }

  for (const at of m.attributes ?? ([] as attributeMutation[])) {
    const node = byId.get(at.id);
    if (!node) continue;
    if (!node.attributes) node.attributes = {};
    for (const [key, value] of Object.entries(at.attributes)) {
      if (value === null) delete node.attributes[key];
      else node.attributes[key] = value;
    }
  }

  for (const t of m.texts ?? ([] as textMutation[])) {
    const node = byId.get(t.id);
    if (node) node.textContent = t.value ?? '';
  }
}

/** Find the first node matching `selector` by re-deriving selectors from the tree. */
function findBySelector(
  root: MutableNode,
  byId: Map<number, MutableNode>,
  selector: string,
): MutableNode | undefined {
  // Rebuild a NodeIndex over the (mutated) tree and compare derived selectors.
  const index = indexNodes(root);
  for (const [id, node] of byId) {
    const derived = selectorFor(index, id);
    if (derived === selector) return node;
  }
  // Fallback: match the trailing segment (e.g. "#submit") loosely.
  const tail = selector.split('>').pop()?.trim();
  if (tail) {
    for (const [id, node] of byId) {
      const derived = selectorFor(index, id);
      if (derived?.endsWith(tail)) return node;
    }
  }
  return undefined;
}

/**
 * Render a serialized node tree to an HTML-ish string (lightweight, not
 * spec-perfect). Stops descending past {@link MAX_DOM_DEPTH} — emitting a
 * truncation marker instead of recursing — so an adversarial deeply-nested
 * recording can't overflow the stack (this code ingests untrusted blobs).
 */
export function serializeNode(node: serializedNodeWithId, depth = 0): string {
  const n = node as MutableNode;
  switch (node.type) {
    case NodeType.Document: {
      if (depth >= MAX_DOM_DEPTH) return '<!-- [truncated: max depth] -->';
      return nodeChildren(node)
        .map((c) => serializeNode(c, depth + 1))
        .join('');
    }
    case NodeType.DocumentType: {
      const dt = node as unknown as { name: string };
      return `<!DOCTYPE ${dt.name}>`;
    }
    case NodeType.Text: {
      return n.textContent ?? '';
    }
    case NodeType.CDATA:
      return '';
    case NodeType.Comment:
      return `<!--${n.textContent ?? ''}-->`;
    case NodeType.Element: {
      const el = node as unknown as { tagName: string };
      const tag = el.tagName.toLowerCase();
      const attrs = renderAttributes(n.attributes ?? {});
      if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrs}>`;
      if (depth >= MAX_DOM_DEPTH) {
        return `<${tag}${attrs}><!-- [truncated: max depth] --></${tag}>`;
      }
      const children = nodeChildren(node)
        .map((c) => serializeNode(c, depth + 1))
        .join('');
      return `<${tag}${attrs}>${children}</${tag}>`;
    }
    default:
      return '';
  }
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function renderAttributes(attrs: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (value === true) {
      parts.push(` ${key}`);
      continue;
    }
    const str = String(value).replace(/"/g, '&quot;');
    parts.push(` ${key}="${str}"`);
  }
  return parts.join('');
}

/** A single change in a node's history (query_dom_history). */
export interface DomChange {
  readonly ts: number;
  readonly op: 'attribute' | 'text' | 'added' | 'removed';
  /** For attribute changes: the attribute name. */
  readonly attribute?: string;
  /** The new value (attribute value / text content); null = removed. */
  readonly value?: string | null;
}

/**
 * Timeline of attribute and/or text changes for the node a `selector` resolves
 * to in the base FullSnapshot. `op` filters to one dimension; default returns
 * both. Bounded by `limit` for the token budget.
 *
 * v1 resolves the selector against the base FullSnapshot's tree (the common
 * case — querying a stable element). A selector that only matches a
 * dynamically-added node is not resolved here; that's a documented v1 limit.
 */
export interface QueryDomHistoryOptions {
  readonly op?: 'attributeChanges' | 'innerText';
  readonly limit?: number;
}

export function queryDomHistory(
  events: eventWithTime[],
  selector: string,
  options: QueryDomHistoryOptions = {},
): DomChange[] {
  const limit = options.limit ?? 100;
  // Resolve the target id from the first FullSnapshot.
  const fullSnapshot = events.find(isFullSnapshot);
  if (!fullSnapshot) return [];
  const index = indexNodes(fullSnapshot.data.node);
  let targetId: number | undefined;
  for (const [id] of index) {
    if (selectorFor(index, id) === selector) {
      targetId = id;
      break;
    }
  }
  if (targetId === undefined) return [];

  const wantAttr = options.op !== 'innerText';
  const wantText = options.op !== 'attributeChanges';
  const changes: DomChange[] = [];

  for (const e of events) {
    if (!isIncremental(e)) continue;
    const data = e.data as { source: number };
    if (data.source !== IncrementalSource.Mutation) continue;
    const m = data as unknown as mutationData;

    if (wantAttr) {
      for (const at of m.attributes ?? []) {
        if (at.id !== targetId) continue;
        for (const [key, value] of Object.entries(at.attributes)) {
          changes.push({
            ts: e.timestamp,
            op: 'attribute',
            attribute: key,
            value: value === null ? null : String(value),
          });
        }
      }
    }
    if (wantText) {
      for (const t of m.texts ?? []) {
        // Text mutations target the text node; also surface direct text-child
        // edits whose parent is the target (common for innerText changes).
        const parentId = index.get(t.id)?.parentId;
        if (t.id === targetId || parentId === targetId) {
          changes.push({ ts: e.timestamp, op: 'text', value: t.value ?? null });
        }
      }
    }
  }

  return changes.slice(0, limit);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
