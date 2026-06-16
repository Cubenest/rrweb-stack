/** Shared constants for the peek extension. */

/**
 * Native-messaging host id (ADR-0009). The host manifest installed by
 * `@peekdev/mcp`'s postinstall registers this id and points Chrome at the
 * `peek-mcp` binary, which enters native-host mode on the
 * `chrome-extension://<id>` origin argument. Must match
 * `packages/peek-mcp/src/native-host` and the manifest's `name` field.
 */
export const NATIVE_HOST_ID = 'com.cubenest.peek';

/** `chrome.storage.sync` key holding the array of user-enabled origins. */
export const ENABLED_ORIGINS_KEY = 'peek:enabledOrigins';

/**
 * Filename of the MAIN-world rrweb recorder IIFE in the extension package root
 * (a `web_accessible_resource`, see wxt.config.ts). Injected into per-site
 * enabled tabs via `chrome.scripting.executeScript({ world: 'MAIN', files: […]
 * })` (Task 3.19). Built by scripts/build-recorder.mjs in the `build:done`
 * hook — NOT a WXT entrypoint (must be a classic IIFE, P2 PRD §A.2).
 */
export const RECORDER_FILE = 'rrweb-recorder.js';

/**
 * Marker attribute on the in-page recording-indicator shadow host. Used to
 * exclude the host from rrweb capture (recorder `blockSelector`) and from
 * peek's own closed-shadow-root sweep, so peek never records or reports its own
 * indicator. Pure string — safe to bundle into the MAIN-world recorder IIFE.
 */
export const RECORDING_FRAME_HOST_ATTR = 'data-peek-rec-frame';

/**
 * Marker attribute on the in-page shield-overlay closed-shadow host. Used to
 * exclude the host from rrweb capture (recorder `blockSelector`) and from
 * peek's own closed-shadow-root sweep, so the lockout overlay never lands in a
 * recording. Pure string — safe to bundle into the MAIN-world recorder IIFE.
 */
export const SHIELD_HOST_ATTR = 'data-peek-shield-host';

/**
 * Marker attribute on the in-page action-feedback closed-shadow host. Used to
 * exclude the host from rrweb capture (recorder `blockSelector`) so peek's own
 * "I just acted here" cue never lands in a recording. The host is
 * `display:contents` (no layout box), so blocking it leaves NO placeholder
 * rectangle on replay. Pure string — safe to bundle into the MAIN-world
 * recorder IIFE.
 */
export const ACTION_FEEDBACK_HOST_ATTR = 'data-peek-fx';

/**
 * rrweb `blockSelector` for the MAIN-world recorder: a CSS attribute-selector
 * list covering every peek-owned overlay host so neither the recording
 * indicator nor the control shield can ever land in a capture. All hosts live
 * in CLOSED shadow roots (already invisible to rrweb); blocking the empty
 * light-DOM host is defense-in-depth. Derived from the marker constants so
 * the recorder and the closed-shadow sweep stay in lockstep. Pure string —
 * safe to bundle into the MAIN-world recorder IIFE.
 */
export const RECORDER_BLOCK_SELECTOR = `[${RECORDING_FRAME_HOST_ATTR}], [${SHIELD_HOST_ATTR}], [${ACTION_FEEDBACK_HOST_ATTR}]`;
