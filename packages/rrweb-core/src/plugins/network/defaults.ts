// Default options for `getRecordNetworkPlugin`.
//
// Adapted from PostHog's `replay/config.ts` `defaultNetworkOptions`. The
// trimmed differences vs PostHog's version:
//   - `recordPerformance` and `recordInitialRequests` default to `true`
//     here — PostHog's defaults to `false` because their config layer
//     gates them on a remote feature flag. Our substrate is opt-out at
//     the plugin level: consumers who want only the timing surface get
//     it by default, and consumers who want bodies/headers opt in
//     explicitly.
//   - `maskRequestFn` default is identity — the real default mask
//     (redactNetworkHeaders + redactBody + URL redaction) is composed
//     inside `record.ts` so it has access to the substrate's masking
//     helpers without an import cycle here.
//   - `payloadHostDenyList` is empty by default. PostHog's defaults
//     include analytics-vendor hostnames (Sentry, Google Analytics,
//     Clarity, …) to avoid feedback loops, but we have no equivalent
//     "always-on PostHog endpoint" — consumers (tracelane, peek)
//     bring their own list per integration.

import type { CapturedNetworkRequest, InitiatorType, MaskRequestFn } from './types.js';

/**
 * The narrow shape of `defaultNetworkOptions`. Every key is required,
 * every value is concrete — no `| undefined` in the union. `record.ts`
 * merges this with the caller's `NetworkRecordOptions` to produce its
 * own `NormalizedNetworkOptions` view.
 */
export interface DefaultedNetworkOptions {
  recordInitialRequests: boolean;
  recordHeaders: boolean | { request: boolean; response: boolean };
  recordBody: boolean | string[] | { request: boolean | string[]; response: boolean | string[] };
  recordPerformance: boolean;
  performanceEntryTypeToObserve: string[];
  initiatorTypes: InitiatorType[];
  payloadSizeLimitBytes: number;
  bodyByteLimit: number;
  maxRequestsPerBatch: number;
  payloadHostDenyList: string[];
  maskRequestFn: MaskRequestFn;
}

/**
 * Fully-defaulted plugin options. Internal — `record.ts` merges this
 * with the caller's options at observer-install time.
 */
export const defaultNetworkOptions: DefaultedNetworkOptions = {
  initiatorTypes: [
    'audio',
    'beacon',
    'body',
    'css',
    'early-hint',
    'embed',
    'fetch',
    'frame',
    'iframe',
    'icon',
    'image',
    'img',
    'input',
    'link',
    'navigation',
    'object',
    'ping',
    'script',
    'track',
    'video',
    'xmlhttprequest',
  ] as InitiatorType[],
  // Identity — the real default mask is composed in `record.ts` because
  // it pulls in the substrate's masking helpers. The identity here is
  // also what `record.ts` uses as a sentinel to detect "no consumer
  // mask provided" (referential equality check).
  maskRequestFn: (data: CapturedNetworkRequest): CapturedNetworkRequest => data,
  recordHeaders: false,
  recordBody: false,
  recordInitialRequests: true,
  recordPerformance: true,
  performanceEntryTypeToObserve: ['first-input', 'navigation', 'paint', 'resource'],
  payloadSizeLimitBytes: 1_000_000,
  bodyByteLimit: 5_000,
  maxRequestsPerBatch: 1_000,
  payloadHostDenyList: [],
};
