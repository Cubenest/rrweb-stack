// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { RECORDING_FRAME_HOST_ATTR } from '../constants';
import { FRAME_CSS, createRecordingFrame } from '../indicators/frame';

afterEach(() => {
  for (const n of document.documentElement.querySelectorAll(`[${RECORDING_FRAME_HOST_ATTR}]`)) {
    n.remove();
  }
});

describe('FRAME_CSS', () => {
  it('is non-intrusive, reduced-motion-aware, and print-hidden', () => {
    expect(FRAME_CSS).toContain('position: fixed');
    expect(FRAME_CSS).toContain('inset: 0');
    expect(FRAME_CSS).toContain('pointer-events: none');
    expect(FRAME_CSS).toContain('z-index: 2147483647');
    expect(FRAME_CSS).toContain('rgba(248, 113, 113'); // peek red glow
    expect(FRAME_CSS).toContain('prefers-reduced-motion');
    expect(FRAME_CSS).toContain('@media print');
  });
});

describe('createRecordingFrame', () => {
  it('mounts a marked, aria-hidden, CLOSED-shadow host on <html>', () => {
    const frame = createRecordingFrame();
    frame.show();
    const host = document.documentElement.querySelector(
      `[${RECORDING_FRAME_HOST_ATTR}]`,
    ) as HTMLElement | null;
    expect(host).not.toBeNull();
    expect(host?.getAttribute('aria-hidden')).toBe('true');
    // Closed shadow root → unreachable from outside → rrweb cannot serialize it.
    expect(host?.shadowRoot).toBeNull();
  });

  it('is idempotent — a second show() does not mount a second host', () => {
    const frame = createRecordingFrame();
    frame.show();
    frame.show();
    expect(
      document.documentElement.querySelectorAll(`[${RECORDING_FRAME_HOST_ATTR}]`),
    ).toHaveLength(1);
  });

  it('hide() removes the host', () => {
    const frame = createRecordingFrame();
    frame.show();
    frame.hide();
    expect(document.documentElement.querySelector(`[${RECORDING_FRAME_HOST_ATTR}]`)).toBeNull();
  });

  it('show() after hide() re-mounts the host', () => {
    const frame = createRecordingFrame();
    frame.show();
    frame.hide();
    frame.show();
    expect(document.documentElement.querySelector(`[${RECORDING_FRAME_HOST_ATTR}]`)).not.toBeNull();
  });
});
