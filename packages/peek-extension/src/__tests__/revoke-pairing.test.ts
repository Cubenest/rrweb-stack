/**
 * Tests for the SP4 Task 7 revoke-pairing flow.
 *
 * The background.ts `revokePairing` handler lives inside the `defineBackground`
 * closure and is not unit-testable directly. We test the SAME logical flow via
 * a pure harness that mirrors the structure of `runHandleRevokePairing`:
 *
 *   - validate the message is well-formed (isRevokePairing)
 *   - validate it came from the side panel (isFromSidePanel)
 *   - call clearPairedConnector(connectorId)
 *   - after revoke, verifyConnectorSecret returns false for that id
 *
 * This follows the same approach as pairing-prompt.test.ts: pure-function
 * coverage with Chrome storage mocked via fakeBrowser. The PairedConnectors
 * list component is not rendered here — no React/DOM harness in the extension
 * suite; it is type-checked only via tsc.
 */

import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isFromSidePanel, isRevokePairing } from '../messaging/protocol';
import type { StorageAreaLike } from '../permissions/pairing-store';
import {
  clearPairedConnector,
  getPairedConnectors,
  putPairedConnector,
  sha256Hex,
  verifyConnectorSecret,
} from '../permissions/pairing-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const area = fakeBrowser.storage.local as unknown as StorageAreaLike;

/** Build a minimal MessageSender whose url is the side-panel page. */
function sidePanelSender(extensionId: string): { url: string } {
  return { url: `chrome-extension://${extensionId}/sidepanel.html` };
}

/** Build a minimal MessageSender from a content script tab (not the side panel). */
function tabSender(): { url: string } {
  return { url: 'https://example.com/' };
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  fakeBrowser.reset();
});

// ---------------------------------------------------------------------------
// isRevokePairing + isFromSidePanel gate
// ---------------------------------------------------------------------------

describe('revoke-pairing message gate', () => {
  const PANEL_URL = 'chrome-extension://abcd/sidepanel.html';

  it('accepts a well-formed revokePairing from the side panel', () => {
    const msg = { type: 'revokePairing', connectorId: 'cursor-mcp' };
    const sender = sidePanelSender('abcd');
    expect(isRevokePairing(msg)).toBe(true);
    expect(isFromSidePanel(sender, PANEL_URL)).toBe(true);
  });

  it('rejects a revokePairing from a non-side-panel sender', () => {
    const msg = { type: 'revokePairing', connectorId: 'cursor-mcp' };
    const sender = tabSender();
    expect(isRevokePairing(msg)).toBe(true);
    // Sender is NOT the side panel — the handler must reject it.
    expect(isFromSidePanel(sender, PANEL_URL)).toBe(false);
  });

  it('rejects a malformed revokePairing (empty connectorId) from the side panel', () => {
    const msg = { type: 'revokePairing', connectorId: '' };
    expect(isRevokePairing(msg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clearPairedConnector — the store-level effect of a revoke
// ---------------------------------------------------------------------------

describe('revoke-pairing store effect', () => {
  it('clearPairedConnector removes the entry; getPairedConnectors no longer has that id', async () => {
    const hash = await sha256Hex('some-secret');
    await putPairedConnector(
      'cursor-mcp',
      { clientName: 'Cursor MCP', hash, pairedAtMs: 1000 },
      area,
    );

    // Confirm it is present.
    const before = await getPairedConnectors(area);
    expect(before['cursor-mcp']).toBeDefined();

    // Revoke it.
    await clearPairedConnector('cursor-mcp', area);

    // Confirm it is gone.
    const after = await getPairedConnectors(area);
    expect(after['cursor-mcp']).toBeUndefined();
    expect(Object.keys(after)).toHaveLength(0);
  });

  it('clearPairedConnector is a no-op for an unknown id', async () => {
    // Should not throw.
    await expect(clearPairedConnector('nonexistent-id', area)).resolves.not.toThrow();
  });

  it('after revoke, verifyConnectorSecret returns false for the revoked id', async () => {
    const secret = 'test-secret-abc';
    const hash = await sha256Hex(secret);
    await putPairedConnector(
      'claude-code',
      { clientName: 'Claude Code', hash, pairedAtMs: 2000 },
      area,
    );

    // Before revoke: verification passes.
    expect(await verifyConnectorSecret('claude-code', secret, area)).toBe(true);

    // Revoke.
    await clearPairedConnector('claude-code', area);

    // After revoke: verification fails (entry gone → banner fallback).
    expect(await verifyConnectorSecret('claude-code', secret, area)).toBe(false);
  });

  it('revoke only removes the targeted connector, leaving others intact', async () => {
    const hash1 = await sha256Hex('secret-1');
    const hash2 = await sha256Hex('secret-2');
    await putPairedConnector(
      'cursor-mcp',
      { clientName: 'Cursor MCP', hash: hash1, pairedAtMs: 1000 },
      area,
    );
    await putPairedConnector(
      'claude-code',
      { clientName: 'Claude Code', hash: hash2, pairedAtMs: 2000 },
      area,
    );

    await clearPairedConnector('cursor-mcp', area);

    const after = await getPairedConnectors(area);
    expect(after['cursor-mcp']).toBeUndefined();
    expect(after['claude-code']).toBeDefined();
    expect(Object.keys(after)).toHaveLength(1);
  });
});
