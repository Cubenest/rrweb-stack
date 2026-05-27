// One local re-export point for the rrweb wire-format types + enums the event
// walker needs. Everything funnels through @cubenest/rrweb-core (the package
// that owns the vendored rrweb surface) so peek-mcp never depends on the
// PostHog rrweb-types package directly — if upstream shifts, rrweb-core is the
// single place that breaks (ADR-0002).

export {
  EventType,
  IncrementalSource,
  MouseInteractions,
  NodeType,
} from '@cubenest/rrweb-core';

export type {
  eventWithTime,
  serializedNodeWithId,
  incrementalData,
  incrementalSnapshotEvent,
  fullSnapshotEvent,
  metaEvent,
  mouseInteractionData,
  inputData,
  mutationData,
  addedNodeMutation,
  attributeMutation,
  textMutation,
} from '@cubenest/rrweb-core';
