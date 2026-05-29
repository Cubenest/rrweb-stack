// Lightweight pin on the J.6 (alpha.7) rrweb checkout configuration. The
// MAIN-world recorder is bundled as a classic IIFE by esbuild and runs in the
// page realm — we can't import + execute it inside vitest without spinning up
// a full DOM, and a `record({...})` call would start a real recorder. So we
// pin the *config values* via a textual probe of the source file.
//
// Pre-J.6 fix: the recorder had no `checkoutEveryNms` set → rrweb emitted ONE
// FullSnapshot per session and the MCP `get_dom_snapshot` walker often failed
// to find a snapshot at/before the error timestamp on long sessions. Alpha.7
// adds `checkoutEveryNms: 120_000` + `checkoutEveryN: 5000` so the look-back
// window is bounded. This test guards against an accidental removal.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RECORDER_SRC = resolve(__dirname, '..', 'recorder', 'recorder-entry.ts');

describe('recorder-entry: rrweb checkout cadence (J.6 alpha.7)', () => {
  const src = readFileSync(RECORDER_SRC, 'utf8');

  it('sets checkoutEveryNms to 120_000 (2 min) so the get_dom_snapshot look-back window is bounded', () => {
    expect(src).toMatch(/checkoutEveryNms:\s*120_000/);
  });

  it('sets checkoutEveryN to 5000 as a secondary trigger for bursty-mutation pages', () => {
    expect(src).toMatch(/checkoutEveryN:\s*5000/);
  });

  it('both checkout fields are inside the `record({...})` call (the only place rrweb reads them)', () => {
    // Find the record({...}) call and check both fields land in its options.
    const recordCall = src.match(/record\(\s*\{[\s\S]*?\}\s*as\s+Parameters/);
    expect(recordCall).not.toBeNull();
    if (recordCall) {
      expect(recordCall[0]).toContain('checkoutEveryNms: 120_000');
      expect(recordCall[0]).toContain('checkoutEveryN: 5000');
    }
  });

  it('documents the trade-off inline (disk size vs reconstruction window)', () => {
    // The maintainer rule (per the alpha.7 task spec) — document the trade-off
    // so the next person tuning these values understands why 120s, not 30s
    // (tracelane's default) or 600s.
    expect(src).toMatch(/J\.6/i);
    expect(src).toMatch(/trade-?off/i);
  });
});
