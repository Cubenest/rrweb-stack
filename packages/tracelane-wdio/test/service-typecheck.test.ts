import type { Services } from '@wdio/types';
import { describe, expect, it } from 'vitest';
import TraceLaneService from '../src/service';

// T-4 (2026-05-28 QA walk): users in their wdio.conf.ts write
//   services: [[TraceLaneService, { mode: 'failed', outDir: '...' }]]
// and expect that to typecheck. Prior to alpha.3 the constructor signature
// for `_capabilities` and `config` was narrower than `Services.ServiceClass`
// expects, so the class wasn't assignable to ServiceClass — even though the
// runtime behavior was fine. These tests assert the assignability holds at
// the type level (the file fails to COMPILE if the regression returns).

describe('TraceLaneService — type compatibility with Services.ServiceClass (T-4)', () => {
  it('is assignable to Services.ServiceClass (the shape WDIO checks at config time)', () => {
    // Pure type-level assertion: if TraceLaneService's constructor signature
    // diverges from ServiceClass, this line errors at `tsc` time. The runtime
    // assertion exists only to keep vitest happy.
    const cls: Services.ServiceClass = TraceLaneService;
    expect(typeof cls).toBe('function');
  });

  it('accepts the `services: [Class, options]` tuple shape from wdio.conf.ts', () => {
    // Mirror the user-facing wdio.conf.ts pattern. The tuple type comes from
    // WDIO's own `ServiceEntry`. We don't import that full type to keep the
    // test focused — instead we assert the tuple is assignable to the same
    // [ServiceClass, options] shape WDIO expects.
    type ServiceTuple = [Services.ServiceClass, WebdriverIO.ServiceOption];
    const entry: ServiceTuple = [TraceLaneService, { mode: 'failed', outDir: '/tmp/reports' }];
    expect(entry[0]).toBe(TraceLaneService);
  });

  it('can be constructed with the (options, capabilities, config) triple WDIO calls it with', () => {
    // Smoke runtime construction — passing real-shape args mirroring how
    // WDIO instantiates a Service. Just verifies the constructor doesn't
    // throw under the typed call.
    const svc = new TraceLaneService(
      { mode: 'failed' },
      { browserName: 'chrome' },
      { framework: 'mocha' },
    );
    expect(svc).toBeInstanceOf(TraceLaneService);
  });
});
