import { describe, expect, it } from 'vitest';
import { normalizeResult } from '../src/framework-result';

// The result-shape switch (P1 PRD §A.2). Mocha/Jasmine deliver an afterTest
// `result` object; Cucumber delivers a World (+ optional PickleResult). These
// tests lock the normalization to one neutral { passed, status, error, duration }.

describe('normalizeResult — Mocha / Jasmine', () => {
  it('maps a passing afterTest result', () => {
    const r = normalizeResult('mocha', { passed: true, duration: 1200 });
    expect(r).toMatchObject({ passed: true, status: 'passed', durationMs: 1200 });
    expect(r.error).toBeUndefined();
  });

  it('maps a failing result with an assertion error to status "failed"', () => {
    const error = new Error('expected element to be visible');
    const r = normalizeResult('mocha', { passed: false, duration: 800, error });
    expect(r.passed).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.error).toContain('expected element to be visible');
    expect(r.durationMs).toBe(800);
  });

  it('maps a failing result with no error to status "broken"', () => {
    const r = normalizeResult('jasmine', { passed: false });
    expect(r.passed).toBe(false);
    expect(r.status).toBe('broken');
  });

  it('maps a skipped result', () => {
    const r = normalizeResult('mocha', { passed: false, skipped: true });
    expect(r.status).toBe('skipped');
  });

  it('treats an unknown framework like Mocha/Jasmine (afterTest shape)', () => {
    const r = normalizeResult(undefined, { passed: true, duration: 5 });
    expect(r).toMatchObject({ passed: true, status: 'passed', durationMs: 5 });
  });

  it('coerces a plain string error', () => {
    const r = normalizeResult('mocha', { passed: false, error: 'boom' });
    expect(r.error).toBe('boom');
    expect(r.status).toBe('failed');
  });
});

describe('normalizeResult — Cucumber', () => {
  it('reads a passing scenario from the World status', () => {
    const world = { result: { status: 'PASSED', duration: { seconds: 1, nanos: 500_000_000 } } };
    const r = normalizeResult('cucumber', world);
    expect(r.passed).toBe(true);
    expect(r.status).toBe('passed');
    expect(r.durationMs).toBe(1500);
  });

  it('prefers an explicit PickleResult.passed flag over the World status', () => {
    const world = { result: { status: 'PASSED' } };
    const pickle = { passed: false, error: 'step failed' };
    const r = normalizeResult('cucumber', world, pickle);
    expect(r.passed).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('step failed');
  });

  it('maps a failed scenario message when no PickleResult error is present', () => {
    const world = { result: { status: 'FAILED', message: 'AssertionError: nope' } };
    const r = normalizeResult('cucumber', world);
    expect(r.passed).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('AssertionError: nope');
  });

  it('maps a skipped/pending scenario', () => {
    const world = { result: { status: 'SKIPPED' } };
    const r = normalizeResult('cucumber', world);
    expect(r.status).toBe('skipped');
  });

  it('handles a missing World result object without throwing', () => {
    const r = normalizeResult('cucumber', {});
    expect(r.passed).toBe(false);
    // No status + no error -> broken.
    expect(r.status).toBe('broken');
  });
});
