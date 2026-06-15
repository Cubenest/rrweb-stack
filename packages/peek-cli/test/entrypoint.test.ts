import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isDirectInvocation } from '../src/lib/entrypoint.js';

// The bin entry guard must decide "was this module run as `node thisfile` (or an
// npm bin shim) vs imported". The original guard string-concatenated
// `file://${process.argv[1]}`, which produced an INVALID url on Windows
// (`file://C:\…\peek.js`, backslashes) so it never matched `import.meta.url`
// (`file:///C:/…/peek.js`) — `main()` never ran and `peek init` was a silent
// no-op on Windows. It also dropped percent-encoding for paths with spaces on
// every platform. `isDirectInvocation` must use pathToFileURL so both classes
// of path compare correctly.

describe('isDirectInvocation', () => {
  it('matches when argv1 is the same file as the module url', () => {
    const file = '/usr/local/lib/node_modules/@peekdev/cli/dist/index.js';
    const metaUrl = pathToFileURL(file).href;
    expect(isDirectInvocation(metaUrl, file, (p) => p)).toBe(true);
  });

  it('matches a path containing spaces (percent-encoding the naive concat dropped)', () => {
    // `file://${argv1}` would yield `file:///Users/john doe/...` (space NOT
    // encoded) which never equals import.meta.url's `…/john%20doe/…`.
    const file = '/Users/john doe/peek/dist/index.js';
    const metaUrl = pathToFileURL(file).href;
    expect(metaUrl).toContain('john%20doe'); // sanity: meta url IS encoded
    expect(isDirectInvocation(metaUrl, file, (p) => p)).toBe(true);
  });

  it('does not match when argv1 is a different file', () => {
    const metaUrl = pathToFileURL('/opt/peek/dist/index.js').href;
    expect(isDirectInvocation(metaUrl, '/opt/peek/dist/other.js', (p) => p)).toBe(false);
  });

  it('falls back to the realpath-resolved argv1 when the direct path differs', () => {
    const real = '/opt/peek/dist/index.js';
    const link = '/usr/local/bin/peek';
    const metaUrl = pathToFileURL(real).href;
    const realpath = (p: string) => (p === link ? real : p);
    expect(isDirectInvocation(metaUrl, link, realpath)).toBe(true);
  });

  it('returns false when argv1 is undefined (imported, no entry path)', () => {
    const metaUrl = pathToFileURL('/opt/peek/dist/index.js').href;
    expect(isDirectInvocation(metaUrl, undefined, (p) => p)).toBe(false);
  });

  it('returns false (does not throw) when realpath throws', () => {
    const metaUrl = pathToFileURL('/opt/peek/dist/index.js').href;
    const realpath = () => {
      throw new Error('ENOENT');
    };
    expect(isDirectInvocation(metaUrl, '/some/other/path.js', realpath)).toBe(false);
  });
});
