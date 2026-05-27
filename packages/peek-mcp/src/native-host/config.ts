// Load-time helpers shared by the postinstall script and the CLI's
// `peek status`: where the extension IDs live and which binary the browser
// should spawn as the native host.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ExtensionIds } from './manifest.js';

/**
 * Path to the published `extension-ids.json`, resolved relative to this module
 * (the file is shipped both in `src/` and copied next to the built output).
 */
export function extensionIdsPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'extension-ids.json');
}

// Each id, when present, must be a string. Keys may be absent (defaulted to
// ''), but a non-string value or unparseable file fails loudly rather than
// being silently masked by a `?? ''` fallback. Unknown keys (e.g. `$comment`)
// are ignored.
const ExtensionIdsSchema = z
  .object({
    chromeWebStore: z.string().optional(),
    edgeAddons: z.string().optional(),
    dev: z.string().optional(),
  })
  .passthrough();

/**
 * Read, parse, and validate the configured extension IDs (Chrome Web Store /
 * Edge / dev). Throws if the file is missing, not JSON, or has a non-string id.
 */
export function loadExtensionIds(path: string = extensionIdsPath()): ExtensionIds {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(
      `peek: failed to read extension-ids.json at ${path} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = ExtensionIdsSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`peek: invalid extension-ids.json at ${path} — ${parsed.error.message}`);
  }
  return {
    chromeWebStore: parsed.data.chromeWebStore ?? '',
    edgeAddons: parsed.data.edgeAddons ?? '',
    dev: parsed.data.dev ?? '',
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
