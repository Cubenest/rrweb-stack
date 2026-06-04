import { describe, expect, it } from 'vitest';
import {
  PERMISSION_LEVELS,
  type PermissionLevel,
  permissionLevelInfo,
} from '../permissions/levels';

describe('PERMISSION_LEVELS — trust-dial presentation fields', () => {
  it('has the five levels 0..4 in escalation order', () => {
    expect(PERMISSION_LEVELS.map((i) => i.level)).toEqual([0, 1, 2, 3, 4]);
  });

  it('uses the agreed terse dial labels', () => {
    expect(PERMISSION_LEVELS.map((i) => i.short)).toEqual([
      'Off',
      'Read',
      'Suggest',
      'Confirm',
      'Auto',
    ]);
  });

  it('exposes a non-empty plain-language summary for every level', () => {
    for (const info of PERMISSION_LEVELS) {
      expect(info.summary.length, `summary for level ${info.level}`).toBeGreaterThan(0);
    }
  });

  it('permissionLevelInfo looks a level up by value', () => {
    expect(permissionLevelInfo(1).short).toBe('Read');
    expect(permissionLevelInfo(4).summary).toMatch(/without asking|on its own|no prompts/i);
  });

  it('permissionLevelInfo throws on an unknown level', () => {
    expect(() => permissionLevelInfo(9 as PermissionLevel)).toThrow();
  });
});
