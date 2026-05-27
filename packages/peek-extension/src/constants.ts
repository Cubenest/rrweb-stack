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
