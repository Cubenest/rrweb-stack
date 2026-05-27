import { describe, expect, it } from 'vitest';
import { formatBytes, pad } from '../src/lib/output.js';

describe('formatBytes', () => {
  it('formats bytes under 1 KB as B', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats KB / MB / GB with one decimal under 100', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('rounds to whole units at/above 100', () => {
    expect(formatBytes(150 * 1024)).toBe('150 KB');
  });

  it('guards against negative / non-finite input', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('pad', () => {
  it('right-pads to width', () => {
    expect(pad('ab', 4)).toBe('ab  ');
  });

  it('leaves longer strings unchanged', () => {
    expect(pad('abcdef', 3)).toBe('abcdef');
  });
});
