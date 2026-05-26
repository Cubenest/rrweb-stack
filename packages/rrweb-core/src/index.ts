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
