// Hand-built rrweb event fixtures for the MCP event-walker tests. We construct
// the minimal serialized-DOM + IncrementalSnapshot shapes the walker reads
// (FullSnapshot tree, Meta navigations, MouseInteraction clicks, Input edits,
// Mutation adds/attrs/texts) rather than recording a real browser — the walker
// only cares about the wire shapes, and explicit fixtures make assertions exact.

import {
  EventType,
  IncrementalSource,
  MouseInteractions,
  NodeType,
  type eventWithTime,
  type serializedNodeWithId,
} from '../../src/mcp/rrweb-types.js';

let nextId = 1;
export function freshIds(): void {
  nextId = 1;
}

interface ElOpts {
  readonly attributes?: Record<string, string | boolean>;
  readonly children?: serializedNodeWithId[];
}

/** Build a serialized element node with an auto-assigned id. */
export function el(tagName: string, opts: ElOpts = {}): serializedNodeWithId {
  return {
    id: nextId++,
    type: NodeType.Element,
    tagName,
    attributes: (opts.attributes ?? {}) as Record<string, string | number | true | null>,
    childNodes: opts.children ?? [],
  } as unknown as serializedNodeWithId;
}

/** Build a serialized text node with an auto-assigned id. */
export function text(content: string): serializedNodeWithId {
  return {
    id: nextId++,
    type: NodeType.Text,
    textContent: content,
  } as unknown as serializedNodeWithId;
}

/** Wrap a body subtree in document > html > body. */
export function documentWith(bodyChildren: serializedNodeWithId[]): serializedNodeWithId {
  const body = el('body', { children: bodyChildren });
  const html = el('html', { children: [body] });
  return doc(html);
}

/** Wrap an explicit html subtree (with pre-built body) into a document node. */
export function doc(html: serializedNodeWithId): serializedNodeWithId {
  return {
    id: nextId++,
    type: NodeType.Document,
    childNodes: [html],
  } as unknown as serializedNodeWithId;
}

export function fullSnapshot(root: serializedNodeWithId, timestamp: number): eventWithTime {
  return {
    type: EventType.FullSnapshot,
    data: { node: root, initialOffset: { top: 0, left: 0 } },
    timestamp,
  } as unknown as eventWithTime;
}

export function metaNav(href: string, timestamp: number): eventWithTime {
  return {
    type: EventType.Meta,
    data: { href, width: 1280, height: 800 },
    timestamp,
  } as unknown as eventWithTime;
}

export function clickEvent(id: number, timestamp: number): eventWithTime {
  return {
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.MouseInteraction, type: MouseInteractions.Click, id },
    timestamp,
  } as unknown as eventWithTime;
}

export function inputEvent(id: number, value: string, timestamp: number): eventWithTime {
  return {
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.Input, id, text: value, isChecked: false },
    timestamp,
  } as unknown as eventWithTime;
}

export function mouseMove(timestamp: number): eventWithTime {
  return {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.MouseMove,
      positions: [{ x: 1, y: 1, id: 1, timeOffset: 0 }],
    },
    timestamp,
  } as unknown as eventWithTime;
}

interface MutationOpts {
  readonly adds?: Array<{ parentId: number; nextId: number | null; node: serializedNodeWithId }>;
  readonly removes?: Array<{ parentId: number; id: number }>;
  readonly attributes?: Array<{ id: number; attributes: Record<string, string | null> }>;
  readonly texts?: Array<{ id: number; value: string | null }>;
}

export function mutationEvent(opts: MutationOpts, timestamp: number): eventWithTime {
  return {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      adds: opts.adds ?? [],
      removes: opts.removes ?? [],
      attributes: opts.attributes ?? [],
      texts: opts.texts ?? [],
    },
    timestamp,
  } as unknown as eventWithTime;
}
