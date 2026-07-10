import { describe, expect, it } from 'vitest';
import { getDescriptor, resolveSpawn } from './descriptors.js';
import type { ConnectorEntry } from './registry.js';

describe('getDescriptor', () => {
  it('spawns the pre-bundled slack connector with the running Node binary', () => {
    const desc = getDescriptor('slack');
    if (!desc) throw new Error('slack descriptor missing');
    expect(desc.surface).toBe('slack');
    expect(desc.displayName).toBe('Slack');
    // Bundled connector is run via the same Node that runs the CLI.
    expect(desc.defaultCommand).toBe(process.execPath);
    expect(desc.defaultArgs).toHaveLength(1);
    expect((desc.defaultArgs[0] ?? '').replace(/\\/g, '/')).toMatch(/\/connectors\/slack\.js$/);
  });

  it('returns undefined for unknown surface', () => {
    expect(getDescriptor('nope')).toBeUndefined();
  });
});

describe('resolveSpawn', () => {
  it('uses descriptor defaults when entry has no overrides', () => {
    const entry: ConnectorEntry = { surface: 'slack', enabled: true };
    const { command, args } = resolveSpawn(entry);
    expect(command).toBe(process.execPath);
    expect(args).toHaveLength(1);
    expect((args[0] ?? '').replace(/\\/g, '/')).toMatch(/\/connectors\/slack\.js$/);
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
