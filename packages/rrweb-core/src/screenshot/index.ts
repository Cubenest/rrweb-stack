// Public barrel for the screenshot fallback module.
//
// Locked surface per IMPLEMENTATION_PLAN.md Public API contract (lines
// 721-723): one type (`ScreenshotAdapter`) and two factories
// (`createCDPScreenshotAdapter`, `createTabsScreenshotAdapter`). The
// transport-shape and option types are re-exported so consumers can
// declare-and-pass without importing internal paths.

export type { ScreenshotAdapter } from './types.js';
export {
  createCDPScreenshotAdapter,
  type CDPTransport,
  type CDPScreenshotOptions,
} from './cdp.js';
export {
  createTabsScreenshotAdapter,
  type CaptureVisibleTabFn,
  type TabsScreenshotOptions,
} from './tabs.js';
