import { describe, expect, it } from 'vitest';
import TraceLaneReporter, {
  createPlaywrightExecutor,
  expect as pwExpect,
  resolveOptions,
  test,
} from '../src/index.js';

// The public surface (P1 PRD §B): the package default-exports the Reporter (so
// `reporter: [['@tracelane/playwright', opts]]` works) and named-exports
// { test, expect } (the fixture) + a couple of building blocks.

describe('public index surface', () => {
  it('default-exports the TraceLaneReporter', () => {
    expect(typeof TraceLaneReporter).toBe('function');
    expect(typeof new TraceLaneReporter().printsToStdio).toBe('function');
  });

  it('named-exports the fixture test + expect', () => {
    expect(typeof test).toBe('function');
    expect(typeof pwExpect).toBe('function');
  });

  it('named-exports building blocks (createPlaywrightExecutor, resolveOptions)', () => {
    expect(typeof createPlaywrightExecutor).toBe('function');
    expect(typeof resolveOptions).toBe('function');
  });
});
