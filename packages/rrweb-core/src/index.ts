export {
  record,
  Replayer,
  getRecordConsolePlugin,
  EventType,
  IncrementalSource,
  MouseInteractions,
} from './rrweb';

export type {
  eventWithTime,
  customEvent,
  recordOptions,
} from './rrweb';

// Masking
export {
  maskInputValue,
  maskTextContent,
  redactNetworkHeaders,
  redactBody,
  COMPAT_SELECTORS,
} from './masking';

// Throttling defaults + guards
export { LARGE_DOM_DEFAULTS, applyLargeDomGuards } from './throttling';
export type { ApplyLargeDomGuardsOptions } from './throttling';

// Shadow DOM
export { traverseShadowRoots } from './shadow-dom';
export type { ShadowRootInfo } from './shadow-dom';

// Screenshot fallback
export type { ScreenshotAdapter } from './screenshot';
export {
  createCDPScreenshotAdapter,
  createTabsScreenshotAdapter,
  type CDPTransport,
  type CDPScreenshotOptions,
  type CaptureVisibleTabFn,
  type TabsScreenshotOptions,
} from './screenshot';

// Network capture abstraction
export type { CapturedRequest, CapturedResponse, NetworkCaptureAdapter } from './network';
export {
  createCDPNetworkAdapter,
  createWebRequestNetworkAdapter,
  type CDPNetworkEventSource,
  type CDPNetworkOptions,
  type WebRequestEvent,
  type WebRequestEventSource,
  type WebRequestNetworkOptions,
} from './network';

// Console capture buffer
export {
  createConsoleCaptureBuffer,
  type BasicConsoleLevel,
  type ConsoleCaptureBuffer,
  type ConsoleCaptureOptions,
  type ConsoleEvent,
  type ConsoleLevel,
} from './console';

// Compression helpers (gzip per-batch via fflate)
export { compress, decompress } from './compression';
