import { describe, expect, it } from 'vitest';
import { ALWAYS_FOR_SITE_LEVEL } from '../permissions/levels';

describe('ALWAYS_FOR_SITE_LEVEL — "Always for this site" never silently arms auto', () => {
  it('graduates the origin to act-with-confirm (Level 3)', () => {
    expect(ALWAYS_FOR_SITE_LEVEL).toBe(3);
  });

  it('is strictly below Level 4 (Auto) so it can never silently enable auto-execute', () => {
    expect(ALWAYS_FOR_SITE_LEVEL).toBeLessThan(4);
  });
});
