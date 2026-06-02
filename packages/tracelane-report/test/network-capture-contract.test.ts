import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { __internal } from '@tracelane/core';
import { describe, expect, it, vi } from 'vitest';
import { extractNetwork } from '../src/index.js';

// Cross-package contract (audit A-6): the `[tracelane.net]` line that
// @tracelane/core's network-capture emits on a no-response failure MUST be
// classified as a FAILED network row by @tracelane/report's extractNetwork.
//
// This test lives in @tracelane/report (which already depends on
// @tracelane/core) — NOT in core — so the dependency edge stays one-directional
// (report → core). Putting it in core would add core → report and create a
// build cycle Turbo can't topo-order.
//
// The console plugin captures the page-side console.error into an
// EventType.Plugin (rrweb/console@1) event; we build one with the exact line
// shape core's logger produces and pipe it through the real extractNetwork.

describe('loadingFailed → @tracelane/report extractNetwork contract', () => {
  /** Capture what core's page-side logger would emit for a no-response failure. */
  function netLineFor(url: string, status: number, method: string): string {
    let captured = '';
    const spy = vi.spyOn(console, 'error').mockImplementation((m: string) => {
      captured = m;
    });
    __internal.logNetworkErrorInPage(url, status, method);
    spy.mockRestore();
    return captured;
  }

  /** Wrap a console line in the rrweb console-plugin event shape extractNetwork reads. */
  function consolePluginEvent(message: string, timestamp: number): eventWithTime {
    return {
      type: EventType.Plugin,
      timestamp,
      data: {
        plugin: 'rrweb/console@1',
        payload: { level: 'error', payload: [message], trace: [] },
      },
    } as unknown as eventWithTime;
  }

  it('classifies a status-0 loadingFailed line as a FAILED network row', () => {
    const line = netLineFor('https://api.test/blocked', 0, 'POST');
    expect(line).toBe('[tracelane.net] POST 000 https://api.test/blocked');

    const rows = extractNetwork([consolePluginEvent(line, 1000)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.test/blocked',
      status: 0,
    });
  });
});
