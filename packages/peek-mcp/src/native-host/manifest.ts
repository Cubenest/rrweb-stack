// Native-host manifest construction + install-target resolution (ADR-0007,
// P2 PRD §A7). Everything here is pure and parameterized over the platform,
// home directory, host-binary path, and extension IDs so the postinstall
// side-effects (filesystem / registry writes) can be unit-tested without
// touching the real OS.

import { join } from 'node:path';

/** Reverse-DNS native-host id (ADR-0009 / NAMING.md). */
export const NATIVE_HOST_NAME = 'com.cubenest.peek';

/** The manifest filename written into each NativeMessagingHosts directory. */
export const MANIFEST_FILENAME = `${NATIVE_HOST_NAME}.json`;

/** Shape of the published `src/native-host/extension-ids.json`. */
export interface ExtensionIds {
  readonly chromeWebStore: string;
  readonly edgeAddons: string;
  readonly dev: string;
}

/** A Chrome/Edge native-messaging host manifest. */
export interface NativeHostManifest {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly type: 'stdio';
  readonly allowed_origins: string[];
}

const PLACEHOLDER_PREFIX = 'PLACEHOLDER_';

/**
 * Turn the three configured extension IDs into the `allowed_origins` array.
 * Chrome forbids wildcards, so each id becomes an explicit
 * `chrome-extension://<id>/` origin. Unconfigured placeholder ids are dropped
 * (so a pre-publish install doesn't ship dead origins), de-duplicating the
 * result.
 */
export function allowedOrigins(ids: ExtensionIds): string[] {
  const candidates = [ids.chromeWebStore, ids.edgeAddons, ids.dev];
  const seen = new Set<string>();
  const origins: string[] = [];
  for (const id of candidates) {
    if (!id || id.startsWith(PLACEHOLDER_PREFIX)) continue;
    const origin = `chrome-extension://${id}/`;
    if (seen.has(origin)) continue;
    seen.add(origin);
    origins.push(origin);
  }
  return origins;
}

/**
 * Build the native-host manifest. `hostBinaryPath` is the absolute path the
 * browser will spawn over stdio (the installed `peek-mcp` bin, invoked with
 * `--native-host`). Both Chrome and Edge ids live in the SAME manifest's
 * `allowed_origins` per the Edge "first registry location wins" gotcha
 * (P2 PRD §A7).
 */
export function buildManifest(hostBinaryPath: string, ids: ExtensionIds): NativeHostManifest {
  return {
    name: NATIVE_HOST_NAME,
    description: 'peek local bridge — native messaging host for the peek browser companion',
    path: hostBinaryPath,
    type: 'stdio',
    allowed_origins: allowedOrigins(ids),
  };
}

/** Supported desktop platforms (Node `process.platform` values). */
export type SupportedPlatform = 'darwin' | 'linux' | 'win32';

/** A single place the manifest must be registered. */
export interface InstallTarget {
  /** Human label, e.g. "macOS Chrome" — used in postinstall logging. */
  readonly browser: string;
  /**
   * For darwin/linux: an absolute filesystem path to write the manifest JSON.
   * For win32: omitted (registry targets carry `registryKey` instead).
   */
  readonly manifestPath?: string;
  /**
   * For win32: the HKCU registry key whose default value points at the
   * manifest JSON on disk (Chrome/Edge read the path from the registry).
   */
  readonly registryKey?: string;
}

/**
 * Resolve the per-OS set of native-messaging install targets (P2 PRD §A7).
 *
 * - macOS: Chrome, Chromium, Edge `NativeMessagingHosts/` directories under
 *   `~/Library/Application Support/`.
 * - Linux: Chrome + Chromium `NativeMessagingHosts/` under `~/.config/`.
 * - Windows: HKCU registry keys for Chrome + Edge (the default value of each
 *   key is the on-disk manifest path).
 *
 * `homeDir` is injected for testability.
 */
export function resolveInstallTargets(
  platform: SupportedPlatform,
  homeDir: string,
): InstallTarget[] {
  switch (platform) {
    case 'darwin': {
      const appSupport = join(homeDir, 'Library', 'Application Support');
      return [
        {
          browser: 'macOS Chrome',
          manifestPath: join(
            appSupport,
            'Google',
            'Chrome',
            'NativeMessagingHosts',
            MANIFEST_FILENAME,
          ),
        },
        {
          browser: 'macOS Chromium',
          manifestPath: join(appSupport, 'Chromium', 'NativeMessagingHosts', MANIFEST_FILENAME),
        },
        {
          browser: 'macOS Edge',
          manifestPath: join(
            appSupport,
            'Microsoft Edge',
            'NativeMessagingHosts',
            MANIFEST_FILENAME,
          ),
        },
      ];
    }
    case 'linux': {
      const config = join(homeDir, '.config');
      return [
        {
          browser: 'Linux Chrome',
          manifestPath: join(config, 'google-chrome', 'NativeMessagingHosts', MANIFEST_FILENAME),
        },
        {
          browser: 'Linux Chromium',
          manifestPath: join(config, 'chromium', 'NativeMessagingHosts', MANIFEST_FILENAME),
        },
      ];
    }
    case 'win32': {
      return [
        {
          browser: 'Windows Chrome',
          registryKey: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
        },
        {
          browser: 'Windows Edge',
          registryKey: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
        },
      ];
    }
  }
}
