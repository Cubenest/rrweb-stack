import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isDirectInvocation } from '../src/entrypoint.js';

// Mirrors the @peekdev/cli guard. The original `file://${process.argv[1]}`
// concat produced an invalid url on Windows (backslash argv) and dropped
// percent-encoding on POSIX paths with spaces, so the postinstall direct-run
// guard never matched. pathToFileURL fixes both.

describe('isDirectInvocation', () => {
  it('matches when argv1 is the same file as the module url', () => {
    const file = '/usr/lib/node_modules/@peekdev/mcp/dist/postinstall.js';
    expect(isDirectInvocation(pathToFileURL(file).href, file, (p) => p)).toBe(true);
  });

  it('matches a path containing spaces (percent-encoding the naive concat dropped)', () => {
    const file = '/Users/john doe/mcp/dist/postinstall.js';
    const metaUrl = pathToFileURL(file).href;
    expect(metaUrl).toContain('john%20doe');
    expect(isDirectInvocation(metaUrl, file, (p) => p)).toBe(true);
  });

  it('does not match when argv1 is a different file', () => {
    const metaUrl = pathToFileURL('/opt/mcp/dist/postinstall.js').href;
    expect(isDirectInvocation(metaUrl, '/opt/mcp/dist/index.js', (p) => p)).toBe(false);
  });

  it('falls back to the realpath-resolved argv1 when the direct path differs', () => {
    const real = '/opt/mcp/dist/postinstall.js';
    const link = '/usr/local/bin/peek-postinstall';
    const realpath = (p: string) => (p === link ? real : p);
    expect(isDirectInvocation(pathToFileURL(real).href, link, realpath)).toBe(true);
  });

  it('returns false when argv1 is undefined', () => {
    const metaUrl = pathToFileURL('/opt/mcp/dist/postinstall.js').href;
    expect(isDirectInvocation(metaUrl, undefined, (p) => p)).toBe(false);
  });

  it('returns false (does not throw) when realpath throws', () => {
    const metaUrl = pathToFileURL('/opt/mcp/dist/postinstall.js').href;
    const realpath = () => {
      throw new Error('ENOENT');
    };
    expect(isDirectInvocation(metaUrl, '/other/path.js', realpath)).toBe(false);
  });
});
