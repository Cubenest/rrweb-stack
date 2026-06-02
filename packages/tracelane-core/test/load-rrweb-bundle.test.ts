import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRrwebBundle } from '../src/load-rrweb-bundle.js';

// loadRrwebBundle reads the built in-page rrweb source string off disk. The
// adapter (WDIO / Playwright) passes its own `import.meta.url`; the loader walks
// a list of candidate paths relative to that module and returns the first that
// exists. It is framework-agnostic (lives in @tracelane/core) so every adapter
// shares one implementation.

describe('loadRrwebBundle', () => {
  it('reads the bundle from the first existing candidate path', () => {
    // Point candidatePaths at this test file (guaranteed to exist) to prove
    // resolution; the file content contains the symbol name below. Use
    // fileURLToPath (NOT new URL(...).pathname) so the path resolves on Windows
    // too — pathname yields a leading-slash `/C:/…` that existsSync can't open.
    // This mirrors what the loader itself does internally.
    const src = loadRrwebBundle(import.meta.url, [fileURLToPath(import.meta.url)]);
    expect(src).toContain('loadRrwebBundle');
  });

  it('throws a clear error when no candidate exists', () => {
    expect(() => loadRrwebBundle(import.meta.url, ['/no/such/bundle.js'])).toThrow(/rrweb bundle/i);
  });
});
