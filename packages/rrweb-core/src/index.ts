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
