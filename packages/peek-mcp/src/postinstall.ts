#!/usr/bin/env node
// Postinstall: register the native-messaging host manifest (P2 PRD §A7).
//
// CONSENT GATE (P2 PRD §H1 — the April-2026 Hanff/Anthropic precedent): we must
// NOT silently write files into other vendors' browser directories on `npm
// install`. So by default this script performs a DRY RUN — it prints exactly
// what would be written and where, then exits without touching the filesystem.
// The actual writes happen only when the extension onboarding flow (Phase 3d)
// re-runs the installer with explicit consent, signalled by
// PEEK_INSTALL_NATIVE_HOST=1.
//
// Either way the script logs what it wrote / would write and where, so the
// install side-effects are always visible to the user (Task 3.4 requirement).

import { isDirectInvocation } from './entrypoint.js';
import { hostBinaryPath, loadExtensionIds } from './native-host/config.js';
import { type InstallResult, installManifests } from './native-host/installer.js';
import {
  type SupportedPlatform,
  buildManifest,
  resolveInstallTargets,
} from './native-host/manifest.js';

const SUPPORTED: readonly SupportedPlatform[] = ['darwin', 'linux', 'win32'];

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function logResults(results: InstallResult[], dryRun: boolean): void {
  const verb = dryRun ? 'Would register' : 'Registered';
  for (const r of results) {
    const where = r.manifestPath ?? r.registryKey ?? '(unknown target)';
    if (r.error) {
      console.log(`  ✗ ${r.browser}: ${where} — ${r.error}`);
    } else {
      console.log(`  ${dryRun ? '·' : '✔'} ${verb} ${r.browser}: ${where}`);
    }
  }
}

export function runPostinstall(): void {
  const platform = process.platform as NodeJS.Platform;
  if (!SUPPORTED.includes(platform as SupportedPlatform)) {
    console.log(`peek: native-host registration is not supported on '${platform}'; skipping.`);
    return;
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const ids = loadExtensionIds();
  const manifest = buildManifest(hostBinaryPath(), ids);
  const targets = resolveInstallTargets(platform as SupportedPlatform, home);

  const consented = isTruthyEnv(process.env.PEEK_INSTALL_NATIVE_HOST);
  const dryRun = !consented;

  console.log(`peek native messaging host: ${manifest.name}`);
  console.log(`  host binary: ${manifest.path}`);
  console.log(
    manifest.allowed_origins.length > 0
      ? `  allowed origins: ${manifest.allowed_origins.join(', ')}`
      : '  allowed origins: (none yet — extension IDs are still placeholders)',
  );

  const results = installManifests(targets, manifest, { dryRun });
  logResults(results, dryRun);

  if (dryRun) {
    console.log(
      '\npeek: no files were written. The native host is registered during extension\n' +
        'onboarding (with your consent), or by re-running with PEEK_INSTALL_NATIVE_HOST=1.',
    );
  }
}

// Run when invoked directly (postinstall / manual). Guarded so importing this
// module for tests does not trigger the side-effect path. Uses pathToFileURL
// (see entrypoint.ts) so the guard is correct on Windows backslash paths.
if (isDirectInvocation(import.meta.url, process.argv[1])) {
  try {
    runPostinstall();
  } catch (err) {
    // A postinstall failure must never break `npm install`.
    console.log(`peek: postinstall skipped — ${err instanceof Error ? err.message : String(err)}`);
  }
}
