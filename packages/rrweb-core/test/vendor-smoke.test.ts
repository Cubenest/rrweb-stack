// packages/rrweb-core/test/vendor-smoke.test.ts
import { expect, test } from 'vitest';
import { getRecordConsolePlugin, record } from '../src/rrweb';

test('PostHog rrweb fork exposes getRecordConsolePlugin', () => {
  expect(typeof getRecordConsolePlugin).toBe('function');
});

test('PostHog rrweb fork exposes record', () => {
  expect(typeof record).toBe('function');
});
