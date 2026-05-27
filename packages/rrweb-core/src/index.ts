export {
  record,
  Replayer,
  getRecordConsolePlugin,
  EventType,
  IncrementalSource,
  MouseInteractions,
  NodeType,
} from './rrweb.js';

export type {
  eventWithTime,
  customEvent,
  recordOptions,
  // Serialized-DOM + incremental event shapes for offline stream walking
  // (consumed by @peekdev/mcp's read tools).
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
} from './rrweb.js';

// Masking
export {
  maskInputValue,
  maskTextContent,
  redactNetworkHeaders,
  redactBody,
  COMPAT_SELECTORS,
} from './masking/index.js';

// Throttling defaults + guards
export { LARGE_DOM_DEFAULTS, applyLargeDomGuards } from './throttling/index.js';
export type { ApplyLargeDomGuardsOptions } from './throttling/index.js';

// Shadow DOM
export { traverseShadowRoots } from './shadow-dom/index.js';
export type { ShadowRootInfo } from './shadow-dom/index.js';

// Screenshot fallback
export type { ScreenshotAdapter } from './screenshot/index.js';
export {
  createCDPScreenshotAdapter,
  createTabsScreenshotAdapter,
  type CDPTransport,
  type CDPScreenshotOptions,
  type CaptureVisibleTabFn,
  type TabsScreenshotOptions,
} from './screenshot/index.js';

// Network capture abstraction
export type { CapturedRequest, CapturedResponse, NetworkCaptureAdapter } from './network/index.js';
export {
  createCDPNetworkAdapter,
  createWebRequestNetworkAdapter,
  type CDPNetworkEventSource,
  type CDPNetworkOptions,
  type WebRequestEvent,
  type WebRequestEventSource,
  type WebRequestNetworkOptions,
} from './network/index.js';

// Console capture buffer
export {
  createConsoleCaptureBuffer,
  type BasicConsoleLevel,
  type ConsoleCaptureBuffer,
  type ConsoleCaptureOptions,
  type ConsoleEvent,
  type ConsoleLevel,
} from './console/index.js';

// Compression helpers (gzip per-batch via fflate)
export { compress, decompress } from './compression/index.js';

// IndexedDB persistence helper
export { createSessionStore } from './persistence/index.js';
export type { SessionChunk, SessionStore, SessionStoreOptions } from './persistence/index.js';

// Compatibility matrix
export { COMPATIBILITY_MATRIX, type CompatEntry } from './compat/index.js';
