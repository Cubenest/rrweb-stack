import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expect as pwExpect, test, tracelaneFixture } from '../src/fixture.js';

// The auto-fixture owns the recorder lifecycle around the test body (use()).
// We can't spin up the real Playwright runner under vitest, so we:
//   1. assert the fixture is registered as `auto` on the exported `test`, and
//   2. drive tracelaneFixture directly with a mocked { page } + fake testInfo +
//      a temp outDir (via TRACELANE_OUT_DIR), and assert a report is written on
//      failure and the bundle was injected.

interface FakeContext {
  addInitScript: ReturnType<typeof vi.fn>;
  browser: () => { browserType: () => { name: () => string }; version: () => string };
  newCDPSession: ReturnType<typeof vi.fn>;
}

function fakePage(events: unknown[], browserName = 'firefox') {
  const addInitScript = vi.fn(async () => {});
  const ctx: FakeContext = {
    addInitScript,
    browser: () => ({ browserType: () => ({ name: () => browserName }), version: () => '1.0' }),
    newCDPSession: vi.fn(),
  };
  let drained = false;
  const evaluate = vi.fn(async (_pageFn: unknown, arg: unknown) => {
    const body =
      typeof (arg as { body?: unknown })?.body === 'string' ? (arg as { body: string }).body : '';
    if (body.includes('__tracelane__events') && !body.includes('__tracelane__inited')) {
      if (drained) return [];
      drained = true;
      return events.slice();
    }
    if (body.includes('__tracelane__inited')) return 1;
    return undefined;
  });
  return { evaluate, context: () => ctx, _ctx: ctx };
}

function failedTestInfo() {
  return {
    status: 'failed',
    expectedStatus: 'passed',
    title: 'login fails',
    titlePath: ['firefox', '/x/login.spec.ts', 'login fails'],
    file: '/x/login.spec.ts',
    error: { message: 'boom' },
    duration: 5,
    project: { name: 'firefox' },
  };
}

const RRWEB_STUB =
  'window.rrweb={record:function(){return function(){}},getRecordConsolePlugin:function(){return {}},getRecordNetworkPlugin:function(){return {}}}';

describe('auto-fixture registration', () => {
  it('exports test + expect', () => {
    expect(typeof test).toBe('function');
    expect(typeof pwExpect).toBe('function');
  });

  it('registers a `tracelane` fixture with { auto: true }', () => {
    // COUPLES TO A PLAYWRIGHT INTERNAL: a `base.extend(...)` test stores its
    // fixture registry on a symbol-keyed property `Symbol(testType)`. Each
    // frame in `impl.fixtures` carries a `fixtures` map whose values are the
    // raw `base.extend` tuples `[fn, options]`. We reach in to assert the
    // `tracelane` frame's options are exactly { auto, scope, box } as declared
    // in fixture.ts. If a future Playwright reshapes this, this single
    // assertion fails loudly (the e2e smoke still proves auto-registration
    // behaviorally regardless).
    const testTypeSym = Reflect.ownKeys(test).find(
      (k) => typeof k === 'symbol' && k.toString() === 'Symbol(testType)',
    );
    expect(testTypeSym).toBeDefined();
    const impl = (
      test as unknown as Record<
        symbol,
        { fixtures?: Array<{ fixtures?: Record<string, unknown> }> }
      >
    )[testTypeSym as symbol];
    const entries = (impl.fixtures ?? []).flatMap((frame) => Object.entries(frame.fixtures ?? {}));
    const tracelaneEntry = entries.find(([name]) => name === 'tracelane');
    expect(tracelaneEntry).toBeDefined();
    // The tuple's second element is the fixture options.
    const tuple = tracelaneEntry?.[1] as [
      unknown,
      { auto?: boolean; scope?: string; box?: boolean },
    ];
    expect(tuple[1].auto).toBe(true);
    expect(tuple[1].scope).toBe('test');
    expect(tuple[1].box).toBe(true);
  });
});

describe('tracelaneFixture (driven directly)', () => {
  const prevOut = process.env.TRACELANE_OUT_DIR;
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'tl-pw-fix-'));
    process.env.TRACELANE_OUT_DIR = outDir;
  });

  afterEach(() => {
    if (prevOut === undefined) Reflect.deleteProperty(process.env, 'TRACELANE_OUT_DIR');
    else process.env.TRACELANE_OUT_DIR = prevOut;
  });

  it('injects the bundle and writes a report on failure', async () => {
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }]);
    const use = vi.fn(async () => {});
    await tracelaneFixture(
      { page: page as never },
      use,
      failedTestInfo() as never,
      // inject the rrweb stub so the fixture doesn't read a real built bundle off disk
      () => RRWEB_STUB,
    );
    expect(page._ctx.addInitScript).toHaveBeenCalled();
    expect(use).toHaveBeenCalledTimes(1);
    const files = readdirSync(outDir).filter((f) => f.endsWith('.html'));
    expect(files.length).toBe(1);
    expect(existsSync(join(outDir, files[0] as string))).toBe(true);
  });
});
