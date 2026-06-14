// src/shield/view.ts
import { SHIELD_HOST_ATTR } from '../constants';
import type { ShieldInbound, ViewCommand } from './protocol';

export { SHIELD_HOST_ATTR };

/** Indigo, distinct from the recording-frame red; max z-index; reduced-motion gated. Exported for a string-level reduced-motion guard test (jsdom can't evaluate @media). */
export const SHIELD_CSS = `
.peek-shield-scrim {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  background: rgba(15, 15, 25, 0.18);
  pointer-events: auto;
  box-sizing: border-box;
}
.peek-shield-border {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  box-sizing: border-box;
  box-shadow: inset 0 0 0 3px rgba(99, 102, 241, 0.7), inset 0 0 16px 4px rgba(99, 102, 241, 0.3);
}
@media (prefers-reduced-motion: no-preference) {
  .peek-shield-border { animation: peek-shield-breathe 3s ease-in-out infinite; }
  @keyframes peek-shield-breathe { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
}
.peek-shield-banner {
  all: initial;
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: #1e1b4b;
  color: #fff;
  font: 13px/1.4 system-ui, sans-serif;
  pointer-events: auto;
}
.peek-shield-stop {
  all: unset;
  cursor: pointer;
  margin-left: auto;
  padding: 4px 12px;
  border-radius: 4px;
  background: #6366f1;
  color: #fff;
  font: 600 13px/1 system-ui, sans-serif;
}
@media print { .peek-shield-scrim, .peek-shield-border, .peek-shield-banner { display: none !important; } }
`;

/** Events the capture listener inspects. Scroll/wheel/touchmove deliberately excluded. */
const CAPTURED_EVENTS = [
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'pointerdown',
  'pointerup',
  'keydown',
  'keyup',
  'input',
  'beforeinput',
  'paste',
  'cut',
  'drop',
  'compositionstart',
  'compositionupdate',
  'compositionend',
] as const;

export interface ShieldViewDeps {
  doc?: Document;
  win?: Window;
  sendToSw(msg: ShieldInbound): void;
}

export interface ShieldView {
  apply(cmd: ViewCommand): void;
  dispose(): void;
}

export function createShieldView(deps: ShieldViewDeps): ShieldView {
  const doc = deps.doc ?? document;
  const win = deps.win ?? window;

  let phase: 'down' | 'up' = 'down';
  let lastGen = 0;
  let host: HTMLElement | null = null;
  let stopButton: HTMLButtonElement | null = null;
  let labelEl: HTMLElement | null = null;
  let observer: MutationObserver | null = null;

  const insideOverlay = (t: EventTarget | null): boolean =>
    host !== null && (t === host || (t instanceof Node && host.contains(t)));

  const block = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onCapture = (e: Event): void => {
    if (phase === 'down' || !e.isTrusted) return; // peek's synthetic events pass
    if (e.type === 'keydown') {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Escape') {
        block(e);
        deps.sendToSw({ type: 'shield.stop' });
        return;
      }
      if (ke.key === 'Tab') {
        block(e);
        stopButton?.focus(); // focus trap: keep focus on the only allowed control
        return;
      }
    }
    if (insideOverlay(e.target)) return; // allow Stop activation (click/Enter/Space)
    block(e);
  };

  const buildHost = (): void => {
    if (host || !doc.documentElement) return;
    const el = doc.createElement('div');
    el.setAttribute(SHIELD_HOST_ATTR, '');
    el.setAttribute('aria-hidden', 'false');
    el.style.setProperty('display', 'contents');
    const root = el.attachShadow({ mode: 'closed' });

    const style = doc.createElement('style');
    style.textContent = SHIELD_CSS;

    const scrim = doc.createElement('div');
    scrim.className = 'peek-shield-scrim';
    const border = doc.createElement('div');
    border.className = 'peek-shield-border';

    const banner = doc.createElement('div');
    banner.className = 'peek-shield-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'peek is controlling this page');
    labelEl = doc.createElement('span');
    labelEl.textContent = '🟣 peek is controlling this page';
    const stop = doc.createElement('button');
    stop.type = 'button';
    stop.className = 'peek-shield-stop';
    stop.textContent = 'Stop';
    stop.addEventListener('click', (ev) => {
      ev.preventDefault();
      deps.sendToSw({ type: 'shield.stop' });
    });
    stopButton = stop;
    banner.append(labelEl, stop);

    root.append(style, scrim, border, banner);
    doc.documentElement.appendChild(el);
    host = el;
    stop.focus();

    observer = new MutationObserver(() => {
      if (phase === 'up' && host && !host.isConnected) {
        doc.documentElement.appendChild(host);
      }
    });
    observer.observe(doc.documentElement, { childList: true });
  };

  const teardownHost = (): void => {
    observer?.disconnect();
    observer = null;
    host?.remove();
    host = null;
    stopButton = null;
    labelEl = null;
  };

  const setLabel = (label: string | null): void => {
    if (labelEl) labelEl.textContent = `🟣 ${label ?? 'peek is controlling this page'}`;
  };

  const apply = (cmd: ViewCommand): void => {
    if (cmd.generation < lastGen) {
      // Stale command (e.g. SW restarted, generation reset) — re-announce truth.
      deps.sendToSw({ type: 'shield.ready', generation: lastGen });
      return;
    }
    lastGen = cmd.generation;
    switch (cmd.kind) {
      case 'RAISE':
        phase = 'up';
        buildHost();
        setLabel(cmd.label);
        break;
      case 'LABEL':
        if (phase === 'up') setLabel(cmd.label);
        break;
      case 'LOWER':
        phase = 'down';
        teardownHost();
        break;
    }
  };

  for (const type of CAPTURED_EVENTS) win.addEventListener(type, onCapture, { capture: true });
  deps.sendToSw({ type: 'shield.ready', generation: lastGen });

  return {
    apply,
    dispose(): void {
      for (const type of CAPTURED_EVENTS)
        win.removeEventListener(type, onCapture, { capture: true });
      teardownHost();
      phase = 'down';
    },
  };
}
