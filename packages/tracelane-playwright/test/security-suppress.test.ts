import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUPPRESS_FILE_NAME, loadSecuritySuppressions } from '../src/security-suppress.js';

// Ported from @tracelane/wdio. The loader looks up
// tracelane.security.suppress.json in the project cwd at report-write time and
// is deliberately defensive: a missing / unreadable / malformed / wrong-shaped
// file MUST NEVER throw and MUST degrade to [] (no suppressions).

describe('loadSecuritySuppressions', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tl-pw-suppress-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function writeSuppressFile(contents: string): void {
    writeFileSync(join(cwd, SUPPRESS_FILE_NAME), contents);
  }

  it('parses the canonical { suppressions: [...] } shape', () => {
    writeSuppressFile(
      JSON.stringify({
        suppressions: [
          { signal: 'missing-csp', evidence: 'https://app.test' },
          { signal: 'insecure-cookie' },
        ],
      }),
    );
    expect(loadSecuritySuppressions(cwd)).toEqual([
      { signal: 'missing-csp', evidence: 'https://app.test' },
      { signal: 'insecure-cookie' },
    ]);
  });

  it('parses a bare top-level array', () => {
    writeSuppressFile(JSON.stringify([{ signal: 'mixed-content' }]));
    expect(loadSecuritySuppressions(cwd)).toEqual([{ signal: 'mixed-content' }]);
  });

  it('returns [] when the file is missing', () => {
    expect(loadSecuritySuppressions(cwd)).toEqual([]);
  });

  it('returns [] (no throw) on malformed JSON', () => {
    writeSuppressFile('{ this is not valid json');
    expect(loadSecuritySuppressions(cwd)).toEqual([]);
  });

  it('returns [] on wrong-shaped JSON (object without suppressions array)', () => {
    writeSuppressFile(JSON.stringify({ rules: [{ signal: 'missing-csp' }] }));
    expect(loadSecuritySuppressions(cwd)).toEqual([]);
  });

  it('returns [] on a scalar JSON value', () => {
    writeSuppressFile(JSON.stringify('nope'));
    expect(loadSecuritySuppressions(cwd)).toEqual([]);
  });

  it('drops non-object array elements (lenient element filtering)', () => {
    writeSuppressFile(JSON.stringify(['nope', 42, { signal: 'missing-hsts' }, null]));
    expect(loadSecuritySuppressions(cwd)).toEqual([{ signal: 'missing-hsts' }]);
  });
});
