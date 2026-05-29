/**
 * Lightweight pin on the alpha.6 (Phase 5 task #72) recorder plugin
 * configuration. Same approach as recorder-checkout.test.ts: the MAIN-world
 * recorder is bundled as a classic IIFE by esbuild and runs in the page
 * realm — we can't import + execute it inside vitest without spinning up a
 * full DOM, and a `record({...})` call would start a real recorder. So we
 * pin the *config values* via a textual probe of the source file.
 *
 * Pre-alpha.6: the recorder hand-rolled ~140 LOC of `window.fetch =` /
 * `XMLHttpRequest.prototype.{open,send,setRequestHeader} =` wrappers plus a
 * helper module under `recorder/`. Alpha.6 replaces that with
 * `getRecordNetworkPlugin()` from `@cubenest/rrweb-core`. This test guards
 * against an accidental revert AND ensures the conservative privacy defaults
 * (recordHeaders: false, recordBody: false) stay set.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RECORDER_SRC = resolve(__dirname, '..', 'recorder', 'recorder-entry.ts');

describe('recorder-entry: network plugin registration (alpha.6 task #72)', () => {
  const src = readFileSync(RECORDER_SRC, 'utf8');

  it('imports getRecordNetworkPlugin from @cubenest/rrweb-core', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*getRecordNetworkPlugin[^}]*\}\s*from\s*['"]@cubenest\/rrweb-core['"]/,
    );
  });

  it('registers the network plugin in the record({plugins: [...]}) call', () => {
    // The plugins array must contain `getRecordNetworkPlugin(` (with its open
    // paren — pins it as a CALL, not an import that got unused). The console
    // plugin must remain alongside.
    const recordCall = src.match(/record\(\s*\{[\s\S]*?\}\s*as\s+Parameters/);
    expect(recordCall).not.toBeNull();
    if (recordCall) {
      expect(recordCall[0]).toMatch(/getRecordConsolePlugin\(/);
      expect(recordCall[0]).toMatch(/getRecordNetworkPlugin\(/);
    }
  });

  it('passes recordHeaders: false (privacy default — headers carry auth tokens)', () => {
    expect(src).toMatch(/recordHeaders:\s*false/);
  });

  it('passes recordBody: false (privacy default — bodies carry PII)', () => {
    expect(src).toMatch(/recordBody:\s*false/);
  });

  it('enables PerformanceObserver paths (capture page-load resources the legacy wrappers missed)', () => {
    expect(src).toMatch(/recordInitialRequests:\s*true/);
    expect(src).toMatch(/capturePerformance:\s*true/);
  });

  it('has DELETED the manual fetch monkey-patch (no `window.fetch =`)', () => {
    // alpha.6 removes the inline wrapper shim. A regression that re-adds the
    // hand-rolled fetch patch would mean someone undid the migration; fail loud.
    expect(src).not.toMatch(/window\.fetch\s*=/);
  });

  it('has DELETED the manual XHR monkey-patches (no `XMLHttpRequest.prototype.{open,send,setRequestHeader} =`)', () => {
    expect(src).not.toMatch(/XMLHttpRequest\.prototype\.send\s*=/);
    expect(src).not.toMatch(/XMLHttpRequest\.prototype\.open\s*=/);
    expect(src).not.toMatch(/XMLHttpRequest\.prototype\.setRequestHeader\s*=/);
  });

  it('does NOT import the deleted recorder helper module that the wrappers used', () => {
    // Pin: the helper module was relative to ./ within the recorder dir.
    expect(src).not.toMatch(/from\s*['"]\.\/net[-_]capture/);
  });
});
