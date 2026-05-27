import { createRecorder } from '@tracelane/core';
import { buildReport } from '@tracelane/report';
import { describe, expect, it } from 'vitest';

// Smoke test: confirms the two workspace:* product dependencies this package
// ties together (@tracelane/core's recorder + @tracelane/report's builder)
// resolve and expose the surface @tracelane/wdio is built on.
describe('scaffold: @tracelane/wdio workspace dependencies', () => {
  it('resolves @tracelane/core createRecorder', () => {
    expect(typeof createRecorder).toBe('function');
  });

  it('resolves @tracelane/report buildReport', () => {
    expect(typeof buildReport).toBe('function');
  });
});
