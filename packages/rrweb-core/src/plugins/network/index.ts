// Public barrel for the framework-agnostic network capture plugin.
//
// The plugin emits `EventType.Plugin` events with
// `data.plugin === 'rrweb/network@1'` — the same name as the stalled
// upstream rrweb PR #1689, so when (if) upstream lands we can swap the
// implementation without changing the event payload contract.

export { getRecordNetworkPlugin } from './record.js';
export {
  NETWORK_PLUGIN_NAME,
  type CapturedNetworkRequest,
  type InitiatorType,
  type MaskRequestFn,
  type NetworkData,
  type NetworkHeaders,
  type NetworkRecordOptions,
  type RecordBodyOption,
  type RecordHeadersOption,
} from './types.js';
