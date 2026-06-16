import { describe, expect, it } from 'vitest';
import { loadBetterSqlite3 } from '../src/db/open.js';

// better-sqlite3 is a native module. The bare top-level `import Database from
// 'better-sqlite3'` loaded its `.node` binding at module-evaluation time, so a
// missing / ABI-mismatched / AV-locked prebuild threw BEFORE main() could catch
// it — on Windows especially (no compile-from-source fallback on a stock box),
// the native host died and Chrome saw a silently-closed stdio pipe with no
// actionable message. loadBetterSqlite3 defers the load and wraps failures in a
// message the user can act on.

describe('loadBetterSqlite3', () => {
  it('returns the constructor from the injected require', () => {
    const sentinel = function FakeDatabase() {} as unknown;
    expect(loadBetterSqlite3(() => sentinel)).toBe(sentinel);
  });

  it('wraps a native-module load failure in an actionable error (Node version + platform/arch)', () => {
    const cause = new Error('The specified module could not be found. better_sqlite3.node');
    let thrown: unknown;
    try {
      loadBetterSqlite3(() => {
        throw cause;
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    expect(msg).toMatch(/better-sqlite3/);
    expect(msg).toMatch(/22/); // Node version floor hint
    expect(msg).toContain(process.platform);
    expect(msg).toContain(process.arch);
    expect((thrown as Error).cause).toBe(cause);
  });
});
