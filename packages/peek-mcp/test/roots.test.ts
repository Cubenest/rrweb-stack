import { describe, expect, it } from 'vitest';
import {
  type RootsCapableServer,
  deriveAllowedOrigins,
  resolveRootsScope,
} from '../src/mcp/roots.js';

function fakeServer(opts: {
  caps?: { roots?: unknown };
  listRoots?: () => Promise<{ roots: Array<{ uri: string; name?: string }> }>;
}): RootsCapableServer {
  return {
    getClientCapabilities: () => opts.caps,
    listRoots:
      opts.listRoots ??
      (() => Promise.reject(new Error('listRoots should not be called in this scenario'))),
  };
}

describe('deriveAllowedOrigins', () => {
  it('extracts http(s) origins and ignores file:// roots', () => {
    expect(
      deriveAllowedOrigins([
        { uri: 'file:///Users/x/repo' },
        { uri: 'http://localhost:3000' },
        { uri: 'https://staging.example.com/app' },
      ]),
    ).toEqual(['http://localhost:3000', 'https://staging.example.com']);
  });

  it('dedupes and tolerates malformed URIs', () => {
    expect(
      deriveAllowedOrigins([
        { uri: 'http://localhost:3000/a' },
        { uri: 'http://localhost:3000/b' },
        { uri: 'not a uri' },
      ]),
    ).toEqual(['http://localhost:3000']);
  });
});

describe('resolveRootsScope', () => {
  it('falls back to unscoped when the client lacks the roots capability', async () => {
    const scope = await resolveRootsScope(fakeServer({ caps: {} }));
    expect(scope.allowedOrigins).toBeUndefined();
    expect(scope.reason).toBe('no-roots-capability');
  });

  it('scopes to derived origins when the client returns http roots', async () => {
    const scope = await resolveRootsScope(
      fakeServer({
        caps: { roots: {} },
        listRoots: async () => ({ roots: [{ uri: 'http://localhost:5173' }] }),
      }),
    );
    expect(scope.allowedOrigins).toEqual(['http://localhost:5173']);
    expect(scope.reason).toBe('scoped');
  });

  it('falls back to unscoped when roots yield no http origin (file-only)', async () => {
    const scope = await resolveRootsScope(
      fakeServer({
        caps: { roots: {} },
        listRoots: async () => ({ roots: [{ uri: 'file:///Users/x/repo' }] }),
      }),
    );
    expect(scope.allowedOrigins).toBeUndefined();
    expect(scope.reason).toBe('no-origins-derived');
  });

  it('times out and falls back when the client advertises roots but never answers (claude-code #3315)', async () => {
    const scope = await resolveRootsScope(
      fakeServer({
        caps: { roots: {} },
        // Never resolves — simulates a client that advertises but does not
        // implement roots/list.
        listRoots: () => new Promise(() => {}),
      }),
      { timeoutMs: 50 },
    );
    expect(scope.allowedOrigins).toBeUndefined();
    expect(scope.reason).toBe('roots-timeout');
  });

  it('falls back when listRoots rejects', async () => {
    const scope = await resolveRootsScope(
      fakeServer({
        caps: { roots: {} },
        listRoots: () => Promise.reject(new Error('boom')),
      }),
      { timeoutMs: 200 },
    );
    expect(scope.allowedOrigins).toBeUndefined();
    expect(scope.reason).toBe('roots-error');
  });
});
