import { EventType, getRecordConsolePlugin, record } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';

// Smoke test: confirms the workspace:* dependency on @cubenest/rrweb-core
// resolves and the substrate's public surface is reachable from this package.
describe('scaffold: @cubenest/rrweb-core workspace dependency', () => {
  it('resolves the substrate record + console plugin exports', () => {
    expect(typeof record).toBe('function');
    expect(typeof getRecordConsolePlugin).toBe('function');
  });

  it('exposes the EventType enum with the rrweb numbering', () => {
    expect(EventType.FullSnapshot).toBe(2);
    expect(EventType.IncrementalSnapshot).toBe(3);
    expect(EventType.Meta).toBe(4);
    expect(EventType.Custom).toBe(5);
    expect(EventType.Plugin).toBe(6);
  });
});
