/**
 * Phase 4 signal collectors — barrel re-export. The three modules are Phase 4
 * stubs (Task 3.27) so the MCP-tool surface area exists today without errors;
 * each returns `{ implemented: false }` until the real collector lands.
 */

export {
  type A11yScanResult,
  type A11yViolation,
  scanA11y,
} from './a11y.js';
export {
  type SecuritySignal,
  type SecuritySignalsReport,
  runSecuritySignals,
} from './security.js';
export {
  collectWebVitals,
  type WebVitalReading,
  type WebVitalsCollection,
} from './web-vitals.js';
