import { describe, expect, it } from 'vitest';
import {
  GENESIS_PREV,
  LOCK_GAP_PREV,
  hashLine,
  sha256Hex,
} from '../src/native-host/audit-chain.js';

describe('audit-chain primitives', () => {
  it('sha256Hex returns lowercase 64-char hex and is deterministic', () => {
    const h = sha256Hex(Buffer.from('hello', 'utf8'));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(sha256Hex('hello'));
  });

  it('hashLine ignores exactly one trailing newline', () => {
    expect(hashLine('{"a":1}\n')).toBe(hashLine('{"a":1}'));
    expect(hashLine('{"a":1}\n\n')).not.toBe(hashLine('{"a":1}\n')); // only one stripped
  });

  it('different content yields different hash', () => {
    expect(hashLine('{"a":1}')).not.toBe(hashLine('{"a":2}'));
  });

  // KNOWN-ANSWER VECTOR (will be mirrored verbatim in the peek-cli package to catch drift)
  it('known-answer vector', () => {
    expect(GENESIS_PREV).toBe('peek-audit-genesis-v1');
    expect(LOCK_GAP_PREV).toBe('peek-audit-lockgap-v1');
    // Pinned literal digest so a hash-algorithm change is caught even when both
    // sides of an equality move together; peek-cli mirrors this exact vector.
    const EXPECTED = '546b9e19e7352f1eb907a1c9aa55d945f9e4664238b432c91a297e52e4da0521';
    expect(hashLine('{"seq":1,"prevHash":"peek-audit-genesis-v1"}')).toBe(EXPECTED);
    expect(sha256Hex(Buffer.from('{"seq":1,"prevHash":"peek-audit-genesis-v1"}', 'utf8'))).toBe(
      EXPECTED,
    );
    // Intended edge case (not a bug): hashLine strips exactly one trailing
    // newline, so an empty line and a lone newline hash identically.
    expect(hashLine('')).toBe(hashLine('\n'));
  });
});
