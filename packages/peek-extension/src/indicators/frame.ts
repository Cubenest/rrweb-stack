import { RECORDING_FRAME_HOST_ATTR } from '../constants';

/**
 * The glow, rendered inside the closed shadow root. Red (#f87171) reusing
 * peek's existing glow idiom; an opacity-only breathe gated behind
 * prefers-reduced-motion (WCAG 2.2.2 — never animate box-shadow); hidden in
 * print; max z-index; pointer-events:none so it never intercepts clicks.
 * `all: initial` first so inherited page properties can't bleed through the
 * host, then the explicit frame styles.
 */
export const FRAME_CSS = `
.peek-rec-frame {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  box-sizing: border-box;
  z-index: 2147483647;
  box-shadow:
    inset 0 0 0 3px rgba(248, 113, 113, 0.55),
    inset 0 0 16px 4px rgba(248, 113, 113, 0.28);
  opacity: 0.85;
}
@media (prefers-reduced-motion: no-preference) {
  .peek-rec-frame {
    animation: peek-rec-breathe 3s ease-in-out infinite;
  }
  @keyframes peek-rec-breathe {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 0.9; }
  }
}
@media print {
  .peek-rec-frame { display: none !important; }
}
`;

export interface RecordingFrame {
  show(): void;
  hide(): void;
  dispose(): void;
}

/**
 * Create a recording-indicator frame controller. The glow lives in a CLOSED
 * shadow root on a `display:contents` host appended to `<html>`. Because a
 * closed root reports `host.shadowRoot === null`, rrweb cannot serialize the
 * subtree — nothing is captured on snapshot or mutation, and no placeholder
 * rectangle is emitted. `show()`/`hide()` are idempotent.
 */
export function createRecordingFrame(doc: Document = document): RecordingFrame {
  let host: HTMLElement | null = null;

  const show = (): void => {
    if (host || !doc.documentElement) return;
    const el = doc.createElement('div');
    el.setAttribute(RECORDING_FRAME_HOST_ATTR, '');
    el.setAttribute('aria-hidden', 'true');
    // display:contents: host has no layout box; the shadow DOM is self-contained.
    el.style.setProperty('display', 'contents');
    const root = el.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = FRAME_CSS;
    const frame = doc.createElement('div');
    frame.className = 'peek-rec-frame';
    root.append(style, frame);
    doc.documentElement.appendChild(el);
    host = el;
  };

  const hide = (): void => {
    host?.remove();
    host = null;
  };

  return { show, hide, dispose: hide };
}
