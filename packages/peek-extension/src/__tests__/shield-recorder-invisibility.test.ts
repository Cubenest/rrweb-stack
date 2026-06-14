import { describe, expect, it } from 'vitest';
import { RECORDER_BLOCK_SELECTOR, RECORDING_FRAME_HOST_ATTR, SHIELD_HOST_ATTR } from '../constants';

// Guards the recorder side of "keep peek's overlays out of recordings". The
// recorder runs as a MAIN-world IIFE (recorder-entry.ts) that can't be imported
// into a unit test without executing the rrweb bootstrap, so it now consumes
// the exported RECORDER_BLOCK_SELECTOR instead of inlining the string. These
// assertions therefore exercise the EXACT value rrweb's `blockSelector`
// receives — they fail if either overlay marker is dropped from the wiring.
// (The closed-shadow-sweep skip is covered behaviorally in shadow.test.ts.)
describe('recorder blockSelector', () => {
  it('blocks both the recording-frame host and the shield host', () => {
    expect(RECORDER_BLOCK_SELECTOR).toContain(`[${RECORDING_FRAME_HOST_ATTR}]`);
    expect(RECORDER_BLOCK_SELECTOR).toContain(`[${SHIELD_HOST_ATTR}]`);
  });

  it('is a comma-separated CSS attribute-selector list', () => {
    const selectors = RECORDER_BLOCK_SELECTOR.split(',').map((s) => s.trim());
    expect(selectors).toEqual([`[${RECORDING_FRAME_HOST_ATTR}]`, `[${SHIELD_HOST_ATTR}]`]);
  });

  it('uses distinct markers for the two overlays', () => {
    expect(SHIELD_HOST_ATTR).toBe('data-peek-shield-host');
    expect(SHIELD_HOST_ATTR).not.toBe(RECORDING_FRAME_HOST_ATTR);
  });
});
