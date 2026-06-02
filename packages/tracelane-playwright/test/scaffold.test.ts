import { createRecorder } from '@tracelane/core';
import { buildReport, writeReport } from '@tracelane/report';
import { describe, expect, it } from 'vitest';

// Workspace wiring sanity: the new adapter resolves its shared deps
// (@tracelane/core's recorder + @tracelane/report's writer/builder). If this
// fails, the package.json deps or the build of the shared packages is wrong.

describe('workspace wiring', () => {
  it('resolves shared deps', () => {
    expect(typeof createRecorder).toBe('function');
    expect(typeof writeReport).toBe('function');
    expect(typeof buildReport).toBe('function');
  });
});
