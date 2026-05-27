// Public barrel for the network capture module.
//
// Locked surface per IMPLEMENTATION_PLAN.md Public API contract
// (lines 698-700):
//
//   export type { CapturedRequest, CapturedResponse, NetworkCaptureAdapter } from './network';
//   export { createCDPNetworkAdapter, createWebRequestNetworkAdapter } from './network';
//
// The transport-shape types (`CDPNetworkEventSource`,
// `WebRequestEventSource`) and option types are re-exported so consumers
// can declare-and-pass without importing internal paths.

export type { CapturedRequest, CapturedResponse, NetworkCaptureAdapter } from './types.js';
export {
  createCDPNetworkAdapter,
  type CDPNetworkEventSource,
  type CDPNetworkOptions,
} from './cdp.js';
export {
  createWebRequestNetworkAdapter,
  type WebRequestEvent,
  type WebRequestEventSource,
  type WebRequestNetworkOptions,
} from './web-request.js';
