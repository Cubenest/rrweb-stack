import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';

/**
 * Minimal shape of an rrweb serialized DOM node. `type === 2` is an Element.
 * Pure plain-object view — no DOM API, no rrweb internals beyond this shape.
 */
export interface SNode {
  type?: number;
  tagName?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SNode[];
}

/** Depth-first walk: yields `node`, then recurses into `childNodes`. */
export function* walk(node: SNode | undefined): Generator<SNode> {
  if (!node) return;
  yield node;
  for (const child of node.childNodes ?? []) yield* walk(child);
}

/**
 * Collect serialized-DOM roots from a captured event stream: the `data.node`
 * tree of each FullSnapshot plus each `data.adds[].node` from an
 * IncrementalSnapshot mutation. Shared by the DOM-walking detectors.
 */
export function collectRoots(events: readonly eventWithTime[]): SNode[] {
  const roots: SNode[] = [];
  for (const e of events) {
    if (e.type === EventType.FullSnapshot) {
      roots.push((e.data as { node: SNode }).node);
    } else if (e.type === EventType.IncrementalSnapshot) {
      const adds = (e.data as { adds?: { node?: SNode }[] }).adds;
      if (Array.isArray(adds)) {
        for (const a of adds) if (a.node) roots.push(a.node);
      }
    }
  }
  return roots;
}
