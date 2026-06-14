import { describe, expect, it } from 'vitest';
import { RECORDING_FRAME_HOST_ATTR, SHIELD_HOST_ATTR } from '../constants';

// Lightweight, dependency-free guard: assert both markers are distinct and the
// shield marker exists. The real blockSelector/skip wiring is verified by the
// e2e rrweb-invisibility check and by reading recorder-entry.ts / shadow.ts.
describe('shield recorder markers', () => {
  it('SHIELD_HOST_ATTR exists and differs from the recording-frame marker', () => {
    expect(SHIELD_HOST_ATTR).toBe('data-peek-shield-host');
    expect(SHIELD_HOST_ATTR).not.toBe(RECORDING_FRAME_HOST_ATTR);
  });
});
