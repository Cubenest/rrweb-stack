/**
 * Tests for the SW pairing-prompt round-trip (SP4, Task 5).
 *
 * The background.ts `handlePairRequest` function is NOT unit-testable directly
 * (it lives inside the `defineBackground` closure and wires real
 * `chrome.runtime` / `chrome.sidePanel`). We test the SAME logical flow via a
 * pure harness that mirrors the structure of `handlePairRequest`:
 *
 *   - post `showPair`
 *   - register a `pendingPairings` entry + timeout
 *   - on `approved:true`: mint secret, hash it, call `putPairedConnector`, return `{approved:true, secret}`
 *   - on `approved:false`: return `{approved:false}`, store nothing
 *
 * This is the same testing approach as the confirm-banner tests: pure-function
 * coverage with Chrome APIs mocked (see `isShowConfirmFromBackground` in
 * `confirm-banner.test.ts`). The component render (PairBanner) is not unit-
 * tested here because the extension suite has no React/DOM harness — it is
 * type-checked only (TypeScript compilation covers the prop shapes).
 *
 * connectorId derivation: `clientName` lowercased with runs of non-alphanumeric
 * characters collapsed to a single hyphen, leading/trailing hyphens stripped.
 * Examples: "Cursor MCP" → "cursor-mcp", "Claude Code!" → "claude-code".
 * Collisions (same client name, repeat pairing) overwrite — latest wins.
 */

import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShowPairMessage } from '../messaging/protocol';
import {
  connectorIdFromClientName,
  mintPairingSecret,
  runHandlePairRequest,
} from '../permissions/pair-handler';
import type { StorageAreaLike } from '../permissions/pairing-store';
import { getPairedConnectors, putPairedConnector, sha256Hex } from '../permissions/pairing-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const area = fakeBrowser.storage.local as unknown as StorageAreaLike;

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
});

// ---------------------------------------------------------------------------
// connectorIdFromClientName — derivation rule
// ---------------------------------------------------------------------------
describe('connectorIdFromClientName', () => {
  it('lowercases and collapses non-alphanumeric runs to hyphens', () => {
    expect(connectorIdFromClientName('Cursor MCP')).toBe('cursor-mcp');
    expect(connectorIdFromClientName('Claude Code!')).toBe('claude-code');
    expect(connectorIdFromClientName('My   Client  v2')).toBe('my-client-v2');
  });

  it('strips leading and trailing hyphens', () => {
    expect(connectorIdFromClientName('  Foo  ')).toBe('foo');
    expect(connectorIdFromClientName('!Hello!')).toBe('hello');
  });

  it('preserves digits', () => {
    expect(connectorIdFromClientName('Client v2.0')).toBe('client-v2-0');
  });

  it('returns a non-empty fallback for a degenerate name', () => {
    // An all-symbols name collapses to '' after stripping — use 'connector'.
    const result = connectorIdFromClientName('!@#$%');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// mintPairingSecret — high-entropy base64url from 32 random bytes
// ---------------------------------------------------------------------------
describe('mintPairingSecret', () => {
  it('returns a non-empty base64url string', () => {
    const secret = mintPairingSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(0);
    // base64url: only A-Z a-z 0-9 - _
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces different values on each call (high entropy)', () => {
    const s1 = mintPairingSecret();
    const s2 = mintPairingSecret();
    expect(s1).not.toBe(s2);
  });

  it('encodes 32 bytes → 43 or 44 base64url chars (no padding)', () => {
    // 32 bytes → 256 bits → ceil(256/6) = 43 chars (base64url, no =)
    const secret = mintPairingSecret();
    expect(secret.length).toBeGreaterThanOrEqual(43);
    expect(secret.length).toBeLessThanOrEqual(44);
  });
});

// ---------------------------------------------------------------------------
// runHandlePairRequest — the full SW round-trip (pure harness)
// ---------------------------------------------------------------------------

describe('runHandlePairRequest — approved:true', () => {
  it('mints a secret, stores only the hash, and resolves with approved:true + plaintext', async () => {
    const request: ShowPairMessage = {
      type: 'showPair',
      requestId: 'req-pair-1',
      clientName: 'Cursor MCP',
      code: 'A7F3',
    };

    // Simulate the user approving the pairing after 1 tick.
    const resultPromise = runHandlePairRequest(request, area, (verdict) => {
      // The harness calls this once the showPair is "posted"; simulate approval.
      setTimeout(() => {
        verdict({ type: 'pairVerdict', requestId: request.requestId, approved: true });
      }, 0);
    });

    const result = await resultPromise;

    expect(result.approved).toBe(true);
    expect(typeof result.secret).toBe('string');
    expect((result.secret ?? '').length).toBeGreaterThan(0);

    // Only the HASH is stored — never the raw secret.
    const stored = await getPairedConnectors(area);
    const connectorId = connectorIdFromClientName('Cursor MCP');
    const entry = stored[connectorId];
    expect(entry).toBeDefined();
    expect(entry?.clientName).toBe('Cursor MCP');
    expect(entry?.hash).toBe(await sha256Hex(result.secret as string));
    // Confirm the raw secret is NOT in storage.
    expect(JSON.stringify(stored)).not.toContain(result.secret);
  });

  it('stores the entry under the derived connectorId (collision = overwrite)', async () => {
    // Pre-populate with an old entry.
    const oldHash = await sha256Hex('old-secret');
    await putPairedConnector(
      'cursor-mcp',
      { clientName: 'Cursor MCP', hash: oldHash, pairedAtMs: 1000 },
      area,
    );

    const request: ShowPairMessage = {
      type: 'showPair',
      requestId: 'req-pair-2',
      clientName: 'Cursor MCP',
      code: 'B9D1',
    };

    const resultPromise = runHandlePairRequest(request, area, (verdict) => {
      setTimeout(() => {
        verdict({ type: 'pairVerdict', requestId: request.requestId, approved: true });
      }, 0);
    });

    const result = await resultPromise;
    expect(result.approved).toBe(true);

    const stored = await getPairedConnectors(area);
    // Still only one entry — latest overwrites.
    expect(Object.keys(stored)).toHaveLength(1);
    const entry = stored['cursor-mcp'];
    // Hash must be for the NEW secret, not the old one.
    expect(entry?.hash).not.toBe(oldHash);
    expect(entry?.hash).toBe(await sha256Hex(result.secret as string));
  });

  it('returns the plaintext secret exactly once in the resolved result', async () => {
    const request: ShowPairMessage = {
      type: 'showPair',
      requestId: 'req-pair-3',
      clientName: 'Claude Code',
      code: 'C3E5',
    };

    const resultPromise = runHandlePairRequest(request, area, (verdict) => {
      setTimeout(() => {
        verdict({ type: 'pairVerdict', requestId: request.requestId, approved: true });
      }, 0);
    });

    const result = await resultPromise;

    expect(result.approved).toBe(true);
    // The result carries exactly the secret field (and no error field).
    expect('secret' in result).toBe(true);
    expect('error' in result).toBe(false);
  });
});

describe('runHandlePairRequest — approved:false', () => {
  it('resolves with {approved:false} and stores nothing on denial', async () => {
    const request: ShowPairMessage = {
      type: 'showPair',
      requestId: 'req-pair-deny-1',
      clientName: 'Cursor MCP',
      code: 'D0F0',
    };

    const resultPromise = runHandlePairRequest(request, area, (verdict) => {
      setTimeout(() => {
        verdict({ type: 'pairVerdict', requestId: request.requestId, approved: false });
      }, 0);
    });

    const result = await resultPromise;

    expect(result.approved).toBe(false);
    expect('secret' in result).toBe(false);

    // Nothing written to storage.
    const stored = await getPairedConnectors(area);
    expect(Object.keys(stored)).toHaveLength(0);
  });

  it('does not store anything on timeout', async () => {
    vi.useFakeTimers();

    const request: ShowPairMessage = {
      type: 'showPair',
      requestId: 'req-pair-timeout',
      clientName: 'Cursor MCP',
      code: 'T0ME',
    };

    // Do NOT resolve — let the timeout fire.
    const resultPromise = runHandlePairRequest(
      request,
      area,
      (_verdict) => {
        // intentionally never call verdict
      },
      50, // 50ms timeout for test speed
    );

    // Advance past the timeout.
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.approved).toBe(false);
    expect('secret' in result).toBe(false);

    const stored = await getPairedConnectors(area);
    expect(Object.keys(stored)).toHaveLength(0);

    vi.useRealTimers();
  });
});

describe('runHandlePairRequest — secret never logged', () => {
  it('never calls console.log/warn/error/debug with the plaintext secret', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const request: ShowPairMessage = {
      type: 'showPair',
      requestId: 'req-pair-nolog',
      clientName: 'Test Client',
      code: 'NL01',
    };

    let capturedSecret = '';
    const resultPromise = runHandlePairRequest(request, area, (verdict) => {
      setTimeout(() => {
        verdict({ type: 'pairVerdict', requestId: request.requestId, approved: true });
      }, 0);
    });

    const result = await resultPromise;
    capturedSecret = result.secret ?? '';
    expect(capturedSecret.length).toBeGreaterThan(0);

    // Verify secret never appeared in any console call args.
    const allArgs = [
      ...logSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
      ...debugSpy.mock.calls.flat(),
    ].map(String);

    for (const arg of allArgs) {
      expect(arg).not.toContain(capturedSecret);
    }
  });
});
