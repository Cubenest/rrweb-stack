// `peek init` interactive wizard (Task 3.9, P2 PRD §K.5). This is the
// SIDE-EFFECTFUL shell: it detects MCP-capable clients (pure: init-config.ts),
// prompts which to configure, writes the merged `mcpServers.peek` block into
// each (merge is pure + tested), and then offers to register the native
// messaging host — the consent step the Phase 3a postinstall deliberately
// defers to (it dry-runs unless PEEK_INSTALL_NATIVE_HOST is set; here the user
// affirmatively opts in, so we call the installer directly with realSink).

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import {
  type InstallTarget,
  type SupportedPlatform,
  buildManifest,
  hostBinaryPath,
  installManifests,
  loadExtensionIds,
  realSink,
  resolveInstallTargets,
} from '@peekdev/mcp/native-host';
import { chromeExtensionOrigin, validateChromeExtensionId } from '../lib/extension-id.js';
import { atomicWriteFileSync } from '../lib/fs-atomic.js';
import {
  type DetectedClient,
  PEEK_BLOCK_SNIPPET,
  containsJsonComments,
  detectClients,
  hasPeekServer,
  mergePeekConfig,
  serializeConfig,
} from '../lib/init-config.js';
import { confirm, multiSelect, promptText } from '../lib/prompt.js';

const SUPPORTED: readonly SupportedPlatform[] = ['darwin', 'linux', 'win32'];

/** Thrown by `readConfig` when the file is JSONC (comments) — we won't rewrite it. */
class JsoncConfigError extends Error {
  constructor() {
    super('config contains comments (JSONC)');
    this.name = 'JsoncConfigError';
  }
}

/**
 * Read + parse a client config file, or undefined if absent/empty. Throws
 * `JsoncConfigError` if the file is JSONC (comments) so the caller can route to
 * the "add the block manually" path rather than corrupt it; throws on other
 * invalid JSON.
 */
function readConfig(path: string): unknown {
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, 'utf8').trim();
  if (raw.length === 0) return undefined;
  if (containsJsonComments(raw)) throw new JsoncConfigError();
  return JSON.parse(raw);
}

type WriteOutcome =
  | { ok: true }
  | { ok: false; jsonc: true }
  | { ok: false; jsonc: false; error: string };

/** Merge the peek block into a client's config and write it atomically. */
function writeClientConfig(client: DetectedClient): WriteOutcome {
  let existing: unknown;
  try {
    existing = readConfig(client.configPath);
  } catch (err) {
    if (err instanceof JsoncConfigError) return { ok: false, jsonc: true };
    return { ok: false, jsonc: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    atomicWriteFileSync(client.configPath, serializeConfig(mergePeekConfig(existing)));
    return { ok: true };
  } catch (err) {
    return { ok: false, jsonc: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function configureClients(homeDir: string, cwd: string): Promise<void> {
  const detected = detectClients(homeDir, cwd, existsSync);
  const present = detected.filter((c) => c.exists);

  process.stdout.write(
    present.length > 0
      ? `Detected MCP-capable clients: ${present.map((c) => c.label).join(', ')}\n`
      : 'No MCP client configs detected — you can still create them below.\n',
  );

  const chosen = await multiSelect<DetectedClient>(
    'Which clients would you like to configure? (peek will be added to each)',
    detected.map((c) => ({
      value: c,
      label: c.label,
      // Default-check clients whose config already exists and that aren't
      // manual-only (matches the §K.5 transcript's pre-checked rows).
      checked: c.exists && !c.manualOnly,
      disabled: c.manualOnly,
      hint: c.manualOnly ? 'manual config required' : c.configPath,
    })),
  );

  if (chosen.length === 0) {
    process.stdout.write('No clients selected; skipping MCP config.\n');
    return;
  }

  for (const client of chosen) {
    const already = (() => {
      try {
        return hasPeekServer(readConfig(client.configPath));
      } catch {
        return false;
      }
    })();
    const res = writeClientConfig(client);
    if (res.ok) {
      process.stdout.write(
        `  ${already ? 'Updated' : 'Wrote'} ${client.label}: ${client.configPath}\n`,
      );
    } else if (res.jsonc) {
      // JSONC (comments): don't rewrite — JSON.stringify would strip the
      // comments. Tell the user exactly what to add.
      const snippet = PEEK_BLOCK_SNIPPET.split('\n')
        .map((l) => `      ${l}`)
        .join('\n');
      process.stdout.write(
        [
          `  ! ${client.label}: ${client.configPath} contains comments (JSONC); not modified.`,
          '    Add the peek server manually:',
          `${snippet}\n`,
        ].join('\n'),
      );
    } else {
      process.stdout.write(`  ✗ ${client.label}: ${client.configPath} — ${res.error}\n`);
    }
  }
}

async function registerNativeHost(platform: SupportedPlatform, homeDir: string): Promise<void> {
  const proceed = await confirm(
    '\nRegister the native messaging host now? (writes a manifest into your browser dirs, with your consent)',
    true,
  );
  if (!proceed) {
    process.stdout.write(
      'Skipped native-host registration. Re-run `peek init`, or set PEEK_INSTALL_NATIVE_HOST=1 and reinstall @peekdev/mcp.\n',
    );
    return;
  }

  let extensionIds: ReturnType<typeof loadExtensionIds>;
  try {
    extensionIds = loadExtensionIds();
  } catch (err) {
    process.stdout.write(
      `Could not load extension IDs (${err instanceof Error ? err.message : String(err)}); skipping native-host registration.\n`,
    );
    return;
  }

  // P-10 (2026-05-28 QA walk): the shipped extension-ids.json carries
  // `PLACEHOLDER_*` strings for every slot until the extension is in the
  // Chrome Web Store / Edge Add-ons, and `allowedOrigins()` (correctly) drops
  // those. With nothing else to fill in, the written manifest ends up with
  // `"allowed_origins": []` and Chrome silently blocks
  // `chrome.runtime.connectNative()` — zero sessions ever reach the host.
  //
  // The fix: prompt for the locally-loaded extension's ID (the per-machine
  // 32-char a–p string Chrome assigns to an unpacked extension), validate
  // its shape, and override extensionIds.dev with the captured value before
  // building the manifest. An empty submission is OK — only sensible for a
  // user loading the published CWS build, where the chromeWebStore slot is
  // populated and the `dev` placeholder doesn't matter.
  process.stdout.write(
    [
      '',
      'Paste your unpacked extension ID (from chrome://extensions/, Developer mode toggle ON).',
      "Leave empty to skip — only do this if you're loading the published CWS build.",
      '',
    ].join('\n'),
  );
  const captured = await promptText('Extension ID: ', {
    validate: validateChromeExtensionId,
    allowEmpty: true,
  });
  if (captured) {
    extensionIds = { ...extensionIds, dev: captured };
    process.stdout.write(`allowed_origins includes: ${chromeExtensionOrigin(captured)}\n`);
  } else {
    process.stdout.write(
      'No extension ID provided — `allowed_origins` will only include published IDs (if any).\n',
    );
  }

  const allTargets = resolveInstallTargets(platform, homeDir);
  const chosen = await multiSelect<InstallTarget>(
    'Register native messaging host for:',
    allTargets.map((t) => ({
      value: t,
      label: t.browser,
      checked: true,
      hint: t.manifestPath ?? t.registryKey,
    })),
  );
  if (chosen.length === 0) {
    process.stdout.write('No browsers selected; skipping native-host registration.\n');
    return;
  }

  const manifest = buildManifest(hostBinaryPath(), extensionIds);
  const results = installManifests([...chosen], manifest, { sink: realSink });
  for (const r of results) {
    const where = r.manifestPath ?? r.registryKey ?? '(unknown)';
    if (r.error) process.stdout.write(`  ✗ ${r.browser}: ${where} — ${r.error}\n`);
    else process.stdout.write(`  ✔ Wrote ${r.browser}: ${where}\n`);
  }
}

function nextSteps(): void {
  process.stdout.write(
    [
      '',
      'Next steps:',
      '  1. Install the peek Chrome extension (see the repo README for the store link).',
      '  2. Open Chrome → click the peek icon → enable recording on a site.',
      '  3. In your AI client: ask "what\'s in my last Peek session?"',
      '',
    ].join('\n'),
  );
}

/** Entry for `peek init`; `argv` excludes the `init` token. */
export async function runInit(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'skip-native-host': { type: 'boolean' },
      'skip-clients': { type: 'boolean' },
    },
    allowPositionals: false,
  });

  const platform = process.platform;
  const homeDir = homedir();
  const cwd = process.cwd();

  process.stdout.write('peek init — configure MCP clients + the native messaging host.\n\n');

  if (!values['skip-clients']) {
    await configureClients(homeDir, cwd);
  }

  if (!values['skip-native-host']) {
    if (SUPPORTED.includes(platform as SupportedPlatform)) {
      await registerNativeHost(platform as SupportedPlatform, homeDir);
    } else {
      process.stdout.write(
        `\nNative-host registration is not supported on '${platform}'; skipping.\n`,
      );
    }
  }

  nextSteps();
  return 0;
}
