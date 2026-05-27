import { describe, expect, it } from 'vitest';
import { scenarioIdentity, testIdentity } from '../src/test-identity';

// Shared identity extraction used by both the Service and the hook factory (#4).

describe('testIdentity (Mocha/Jasmine Test/Suite)', () => {
  it('prefers fullTitle over title', () => {
    expect(
      testIdentity({ title: 'logs in', fullTitle: 'Auth logs in', file: 'a.spec.ts' }),
    ).toEqual({ title: 'Auth logs in', spec: 'a.spec.ts' });
  });

  it('falls back to title when fullTitle is absent', () => {
    expect(testIdentity({ title: 'logs in', file: 'a.spec.ts' })).toEqual({
      title: 'logs in',
      spec: 'a.spec.ts',
    });
  });

  it('omits spec when there is no file', () => {
    expect(testIdentity({ title: 'no file' })).toEqual({ title: 'no file' });
  });

  it('uses a placeholder title when neither title nor fullTitle is present', () => {
    expect(testIdentity({})).toEqual({ title: 'unknown test' });
  });
});

describe('scenarioIdentity (Cucumber World)', () => {
  it('reads the pickle name + uri', () => {
    expect(
      scenarioIdentity({ pickle: { name: 'checkout', uri: 'features/checkout.feature' } }),
    ).toEqual({ title: 'checkout', spec: 'features/checkout.feature' });
  });

  it('omits spec when the pickle has no uri', () => {
    expect(scenarioIdentity({ pickle: { name: 'checkout' } })).toEqual({ title: 'checkout' });
  });

  it('uses a placeholder when there is no pickle', () => {
    expect(scenarioIdentity({})).toEqual({ title: 'unknown scenario' });
  });
});
