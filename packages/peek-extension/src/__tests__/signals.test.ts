// Phase 4 signal stubs (Task 3.27, P2 PRD §I/J/K — explicit defer).
//
// The point of these tests isn't to exercise behavior — there isn't any yet.
// They lock the SURFACE so an MCP tool wiring in Phase 4 can rely on the
// function names + the `implemented: false` discriminator. If any of these
// fail it means a follow-up renamed or removed an exported symbol the future
// MCP tools were going to import.

import { describe, expect, it } from 'vitest';
import { collectWebVitals, runSecuritySignals, scanA11y } from '../signals';

describe('Phase 4 signal stubs — exported surface', () => {
  it('scanA11y is callable and returns an empty result with implemented=false', async () => {
    const result = await scanA11y();
    expect(result.violations).toEqual([]);
    expect(result.implemented).toBe(false);
  });

  it('collectWebVitals is callable and returns an empty collection with implemented=false', async () => {
    const result = await collectWebVitals();
    expect(result.readings).toEqual([]);
    expect(result.implemented).toBe(false);
  });

  it('runSecuritySignals is callable and returns an empty report with implemented=false', async () => {
    const result = await runSecuritySignals();
    expect(result.signals).toEqual([]);
    expect(result.implemented).toBe(false);
  });

  it('all three stubs are async (returning thenables, not raw objects)', () => {
    expect(scanA11y()).toBeInstanceOf(Promise);
    expect(collectWebVitals()).toBeInstanceOf(Promise);
    expect(runSecuritySignals()).toBeInstanceOf(Promise);
  });

  it('none of the stubs throw (callable from any context, no chrome.* deps)', async () => {
    await expect(scanA11y()).resolves.toBeDefined();
    await expect(collectWebVitals()).resolves.toBeDefined();
    await expect(runSecuritySignals()).resolves.toBeDefined();
  });
});
