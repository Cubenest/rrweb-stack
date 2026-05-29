import { describe, expect, it } from 'vitest';
import { hasTracelaneEntry, mergeGitignore } from '../src/lib/gitignore.js';

describe('hasTracelaneEntry', () => {
  it('is false for an empty file', () => {
    expect(hasTracelaneEntry('')).toBe(false);
  });

  it('detects the trailing-slash form', () => {
    expect(hasTracelaneEntry('node_modules/\ntracelane-reports/\n')).toBe(true);
  });

  it('detects the no-slash form', () => {
    expect(hasTracelaneEntry('node_modules/\ntracelane-reports\n')).toBe(true);
  });

  it('does not match a partial substring (e.g. tracelane-reports.bak)', () => {
    expect(hasTracelaneEntry('node_modules/\ntracelane-reports.bak/\n')).toBe(false);
  });
});

describe('mergeGitignore', () => {
  it('writes a fresh .gitignore when input is empty', () => {
    const out = mergeGitignore('');
    expect(out).toContain('# tracelane test-failure replay reports');
    expect(out).toContain('tracelane-reports/');
    // Must not start with a leading newline on a brand-new file.
    expect(out.startsWith('\n')).toBe(false);
  });

  it('appends with a separating newline when input has no trailing newline', () => {
    const out = mergeGitignore('node_modules');
    expect(out.startsWith('node_modules\n')).toBe(true);
    expect(out.endsWith('tracelane-reports/\n')).toBe(true);
  });

  it('appends without a duplicate newline when input has a trailing newline', () => {
    const out = mergeGitignore('node_modules\n');
    // No `\n\n\n` (triple) — we don't double the trailing newline. A single
    // `\n\n` blank line BEFORE the tracelane comment is intentional so it
    // doesn't glue to the previous entry.
    expect(out.includes('\n\n\n')).toBe(false);
    expect(out).toContain('node_modules\n');
    expect(out).toContain('tracelane-reports/');
  });

  it('is a no-op if the entry already exists', () => {
    const input = 'node_modules/\ntracelane-reports/\n';
    expect(mergeGitignore(input)).toBe(input);
  });

  it('is a no-op for the no-slash form too', () => {
    const input = 'node_modules/\ntracelane-reports\n';
    expect(mergeGitignore(input)).toBe(input);
  });
});
