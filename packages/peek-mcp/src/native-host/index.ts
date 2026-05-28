// Public native-host surface re-exported for the CLI's `peek status` and
// `peek init` (the consent-gated installer the postinstall defers to). Consumed
// as the `@peekdev/mcp/native-host` subpath export. Pure manifest/target logic
// plus the injectable installer sink — no postinstall side effects leak here.

export {
  extensionIdsPath,
  hostBinaryPath,
  loadExtensionIds,
} from './config.js';
export {
  buildRealSink,
  type InstallOptions,
  type InstallResult,
  type InstallSink,
  installManifests,
  realSink,
  type RegExecFn,
} from './installer.js';
export {
  allowedOrigins,
  buildManifest,
  type ExtensionIds,
  type InstallTarget,
  MANIFEST_FILENAME,
  NATIVE_HOST_NAME,
  type NativeHostManifest,
  resolveInstallTargets,
  type SupportedPlatform,
} from './manifest.js';
