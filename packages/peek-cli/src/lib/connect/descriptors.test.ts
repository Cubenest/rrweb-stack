import { describe, expect, it } from 'vitest';
import { getDescriptor, resolveSpawn } from './descriptors.js';
import type { ConnectorEntry } from './registry.js';

describe('getDescriptor', () => {
  it('returns the slack descriptor for known surface', () => {
    const desc = getDescriptor('slack');
    expect(desc).toEqual({
      surface: 'slack',
      displayName: 'Slack',
      defaultCommand: 'peek-connector-slack',
      defaultArgs: [],
    });
  });

  it('returns undefined for unknown surface', () => {
    expect(getDescriptor('nope')).toBeUndefined();
  });
});

describe('resolveSpawn', () => {
  it('uses descriptor defaults when entry has no overrides', () => {
    const entry: ConnectorEntry = { surface: 'slack', enabled: true };
    expect(resolveSpawn(entry)).toEqual({
      command: 'peek-connector-slack',
      args: [],
    });
  });

  it('uses entry overrides when command and args are set', () => {
    const entry: ConnectorEntry = {
      surface: 'slack',
      enabled: true,
      command: '/x',
      args: ['-y'],
    };
    expect(resolveSpawn(entry)).toEqual({ command: '/x', args: ['-y'] });
  });

  it('throws a clear error for unknown surface with no entry command', () => {
    const entry: ConnectorEntry = { surface: 'unknown', enabled: true };
    expect(() => resolveSpawn(entry)).toThrow(
      "no spawn command for surface 'unknown' — add a descriptor or set command in connectors.json",
    );
  });
});
