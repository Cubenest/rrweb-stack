// Re-export the vendored capture surface.
//
// Engine comes from the PostHog fork (@posthog/rrweb), which is feature-frozen
// at 0.0.34 — see ADR-0002. The fork inherits upstream rrweb 2.x's package
// split, so plugin code is NOT in the main bundle. We pull the console-record
// plugin from the upstream MIT package because event shapes are compatible
// (both descend from rrweb@2.0.0-alpha.17).
//
// If PostHog renames an export, or upstream renames a plugin export, this
// file is where the build will break — that is the smoke test.
export {
  record,
  Replayer,
  EventType,
  IncrementalSource,
  MouseInteractions,
} from '@posthog/rrweb';

export { getRecordConsolePlugin } from '@rrweb/rrweb-plugin-console-record';

// NodeType is a real (numeric) enum in the wire format, re-exported as a value
// so consumers walking serialized snapshots (e.g. @peekdev/mcp's event walker)
// can branch on Document/Element/Text without redeclaring the constants.
export { NodeType } from '@posthog/rrweb-types';

export type {
  eventWithTime,
  customEvent,
  // Serialized-DOM shapes for reconstructing/inspecting snapshots offline.
  serializedNodeWithId,
  // Incremental event shapes the event walker interprets (clicks, inputs,
  // mutations, navigation/meta).
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
} from '@posthog/rrweb-types';

// recordOptions lives in @posthog/rrweb (the engine package), not rrweb-types
// — it's the parameter type of `record<T>(options?: recordOptions<T>)`.
export type { recordOptions } from '@posthog/rrweb';
