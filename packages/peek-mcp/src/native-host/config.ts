// Load-time helpers shared by the postinstall script and the CLI's
// `peek status`: where the extension IDs live and which binary the browser
// should spawn as the native host.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionIds } from './manifest.js';

/**
 * Path to the published `extension-ids.json`, resolved relative to this module
 * (the file is shipped both in `src/` and copied next to the built output).
 */
export function extensionIdsPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'extension-ids.json');
}

/** Read + parse the configured extension IDs (Chrome Web Store / Edge / dev). */
export function loadExtensionIds(path: string = extensionIdsPath()): ExtensionIds {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ExtensionIds>;
  return {
    chromeWebStore: raw.chromeWebStore ?? '',
    edgeAddons: raw.edgeAddons ?? '',
    dev: raw.dev ?? '',
  };
}

/**
 * Absolute path to the installed `peek-mcp` binary the browser spawns as the
 * native host. The built entry is `dist/index.js`; this module lives at
 * `dist/native-host/config.js`, so the bin is one directory up.
 */
export function hostBinaryPath(): string {
  return join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.js');
}
