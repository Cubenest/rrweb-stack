import { describe, expect, it } from 'vitest';
import { wrapperContent, wrapperPath } from '../src/lib/native-host-wrapper.js';

// P-16 (2026-05-28 QA walk) — pure helpers for the native-host wrapper script
// that `peek init` writes. The wrapper hardcodes process.execPath so Chrome's
// system-$PATH lookup can't accidentally find an older Node binary.

describe('wrapperPath', () => {
  it('returns ~/.peek/peek-mcp-host.sh on POSIX (darwin)', () => {
    expect(wrapperPath('/Users/u/.peek', 'darwin')).toBe('/Users/u/.peek/peek-mcp-host.sh');
  });

  it('returns ~/.peek/peek-mcp-host.sh on POSIX (linux)', () => {
    expect(wrapperPath('/home/u/.peek', 'linux')).toBe('/home/u/.peek/peek-mcp-host.sh');
  });

  it('returns ~/.peek/peek-mcp-host.cmd on Windows', () => {
    expect(wrapperPath('C:\\Users\\u\\.peek', 'win32')).toMatch(/peek-mcp-host\.cmd$/);
  });
});

describe('wrapperContent', () => {
  const nodePath = '/opt/homebrew/bin/node';
  const hostJs =
    '/opt/homebrew/lib/node_modules/@peekdev/cli/node_modules/@peekdev/mcp/dist/index.js';

  it('POSIX wrapper uses /bin/sh + exec + "$@" for arg-forwarding', () => {
    const content = wrapperContent(nodePath, hostJs, 'darwin');
    expect(content).toMatch(/^#!\/bin\/sh\n/);
    expect(content).toContain('exec ');
    expect(content).toContain(`"${nodePath}"`);
    expect(content).toContain(`"${hostJs}"`);
    expect(content).toContain('"$@"');
    // LF line endings on POSIX
    expect(content).not.toContain('\r\n');
  });

  it('POSIX wrapper double-quotes both paths defensively', () => {
    const content = wrapperContent('/path with spaces/node', '/p w s/index.js', 'linux');
    expect(content).toContain('"/path with spaces/node"');
    expect(content).toContain('"/p w s/index.js"');
  });

  it('Windows wrapper uses @echo off + %* + CRLF line endings', () => {
    const content = wrapperContent(
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\peek-mcp\\dist\\index.js',
      'win32',
    );
    expect(content).toMatch(/^@echo off\r\n/);
    expect(content).toContain('"C:\\Program Files\\nodejs\\node.exe"');
    expect(content).toContain('"C:\\peek-mcp\\dist\\index.js"');
    expect(content).toContain('%*');
    expect(content).toContain('\r\n');
  });
});
