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
