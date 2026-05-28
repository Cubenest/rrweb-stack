/**
 * Deep capture (Task 3.26, ADR-0010) — opt-in chrome.debugger attach that
 * lets peek record response BODIES. Off by default; per-origin toggle in the
 * side panel.
 */

export { buildChromeDebuggerSurface } from './chrome-debugger.js';
export {
  CDP_PROTOCOL_VERSION,
  type DebuggeeTab,
  DeepCaptureManager,
  type DeepCaptureManagerDeps,
  type DebuggerSurface,
  type ForwardBody,
} from './manager.js';
export {
  DEEP_CAPTURE_ORIGINS_KEY,
  type StorageAreaLike,
  disableDeepCapture,
  enableDeepCapture,
  getDeepCaptureOrigins,
  isDeepCaptureEnabled,
} from './storage.js';
