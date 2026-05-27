import { EventType, compress, decompress } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';

// Smoke test: confirms the workspace:* dependency on @cubenest/rrweb-core
// resolves and the compression surface this package builds on is reachable.
describe('scaffold: @cubenest/rrweb-core workspace dependency', () => {
  it('resolves the substrate compress/decompress exports', () => {
    expect(typeof compress).toBe('function');
    expect(typeof decompress).toBe('function');
  });

  it('exposes the EventType enum with the rrweb numbering', () => {
    expect(EventType.FullSnapshot).toBe(2);
    expect(EventType.IncrementalSnapshot).toBe(3);
    expect(EventType.Meta).toBe(4);
    expect(EventType.Custom).toBe(5);
    expect(EventType.Plugin).toBe(6);
  });
});
