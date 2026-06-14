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
.peek-shield-card {
  all: initial;
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2147483647;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 440px;
  width: calc(100vw - 48px);
  padding: 20px 22px;
  border-radius: 10px;
  background: #1e1b4b;
  color: #fff;
  font: 14px/1.5 system-ui, sans-serif;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
}
.peek-card-framing {
  all: unset;
  display: block;
  font: 600 15px/1.4 system-ui, sans-serif;
  color: #fff;
}
.peek-card-prompt {
  all: unset;
  display: block;
  font: 13px/1.5 system-ui, sans-serif;
  color: #c7d2fe;
}
.peek-card-input {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fff;
  color: #111;
  font: 14px/1.4 system-ui, sans-serif;
}
.peek-card-done {
  all: unset;
  align-self: flex-end;
  cursor: pointer;
  padding: 6px 16px;
  border-radius: 6px;
  background: #6366f1;
  color: #fff;
  font: 600 13px/1 system-ui, sans-serif;
}
@media print { .peek-shield-scrim, .peek-shield-border, .peek-shield-banner, .peek-shield-card { display: none !important; } }
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
  /**
   * Test-only: when true, {@link createShieldView} returns a `__test` seam that
   * lets jsdom drive the closed-shadow handoff card. The relay never sets it.
   */
  exposeTestSeam?: boolean;
}

export interface ShieldView {
  apply(cmd: ViewCommand): void;
  dispose(): void;
  /** Present only when `deps.exposeTestSeam === true` (see {@link ShieldViewDeps}). */
  __test?: {
    handoffCard(): HTMLElement | null;
    clickDone(value?: string): void;
    field(): Element | null;
    phase(): 'down' | 'up' | 'handoff';
  };
}

export function createShieldView(deps: ShieldViewDeps): ShieldView {
  const doc = deps.doc ?? document;
  const win = deps.win ?? window;

  let phase: 'down' | 'up' | 'handoff' = 'down';
  let lastGen = 0;
  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let stopButton: HTMLButtonElement | null = null;
  let labelEl: HTMLElement | null = null;
  let observer: MutationObserver | null = null;

  // Plan B handoff state.
  let cardEl: HTMLElement | null = null;
  let cardInput: HTMLInputElement | null = null;
  let doneButton: HTMLButtonElement | null = null;
  let handoffField: Element | null = null; // the unlocked page field (selector case), by identity
  let doneClicked = false; // in-view double-submit guard for the Done button

  const insideOverlay = (t: EventTarget | null): boolean =>
    host !== null && (t === host || (t instanceof Node && host.contains(t)));

  // During handoff the unlocked field (and its subtree) is allowed in addition
  // to the overlay; everything else stays blocked. `isConnected` re-check guards
  // against a field that was removed from the DOM after we captured it.
  const inAllowSet = (t: EventTarget | null): boolean => {
    if (insideOverlay(t)) return true; // host/card/Stop/Done
    if (phase === 'handoff' && handoffField?.isConnected && t instanceof Node) {
      return t === handoffField || handoffField.contains(t);
    }
    return false;
  };

  const block = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onCapture = (e: Event): void => {
    if (phase === 'down' || !e.isTrusted) return; // peek's synthetic events pass
    if (e.type === 'keydown') {
      const ke = e as KeyboardEvent;
      // Esc is a Stop shortcut ONLY in plain lockout. During handoff the user is
      // typing into the unlocked field/card, so Esc must reach it (native cancel).
      if (ke.key === 'Escape' && phase === 'up') {
        block(e);
        deps.sendToSw({ type: 'shield.stop' });
        return;
      }
      // The lockout focus-trap pins focus to Stop. During handoff the field/card
      // are legitimately focusable, so don't trap there.
      if (ke.key === 'Tab' && phase === 'up') {
        block(e);
        stopButton?.focus(); // focus trap: keep focus on the only allowed control
        return;
      }
    }
    if (inAllowSet(e.target)) return; // allow Stop/Done + the unlocked field
    block(e);
  };

  const buildHost = (): void => {
    if (host || !doc.documentElement) return;
    const el = doc.createElement('div');
    el.setAttribute(SHIELD_HOST_ATTR, '');
    el.setAttribute('aria-hidden', 'false');
    el.style.setProperty('display', 'contents');
    const root = el.attachShadow({ mode: 'closed' });
    shadow = root;

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
      // `handoff` is semantically still "shield up" — the lockout scrim/border/
      // banner AND the handoff card live in this host's shadow root, so a hostile
      // or SPA page that detaches the host mid-handoff would otherwise drop the
      // lockout and the card. Re-append in both phases to keep the page protected.
      if ((phase === 'up' || phase === 'handoff') && host && !host.isConnected) {
        doc.documentElement.appendChild(host);
      }
    });
    observer.observe(doc.documentElement, { childList: true });
  };

  const teardownHandoffCard = (): void => {
    cardEl?.remove();
    cardEl = null;
    cardInput = null;
    doneButton = null;
    handoffField = null;
    doneClicked = false;
  };

  const teardownHost = (): void => {
    teardownHandoffCard();
    observer?.disconnect();
    observer = null;
    host?.remove();
    host = null;
    shadow = null;
    stopButton = null;
    labelEl = null;
  };

  const setLabel = (label: string | null): void => {
    if (labelEl) labelEl.textContent = `🟣 ${label ?? 'peek is controlling this page'}`;
  };

  const setHostPhase = (p: 'down' | 'up' | 'handoff'): void => {
    host?.setAttribute('data-peek-shield-phase', p);
  };

  const buildHandoffCard = (prompt: string, framing: string, selector?: string): void => {
    if (!shadow) return;
    const card = doc.createElement('div');
    card.className = 'peek-shield-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    // peek-authored framing line is dominant; the AI's prompt is set via
    // textContent (never innerHTML) so it can never inject markup.
    const framingEl = doc.createElement('p');
    framingEl.className = 'peek-card-framing';
    framingEl.textContent = framing;
    const promptEl = doc.createElement('p');
    promptEl.className = 'peek-card-prompt';
    promptEl.textContent = prompt;
    card.append(framingEl, promptEl);

    if (selector) {
      // Selector case: unlock the page field by identity, scroll + focus it.
      let el: Element | null = null;
      try {
        el = doc.querySelector(selector);
      } catch {
        el = null;
      }
      handoffField = el;
      if (el instanceof HTMLElement) {
        el.scrollIntoView?.({ block: 'center' });
        el.focus();
      }
    } else {
      // Free-text case: a card-local input.
      const input = doc.createElement('input');
      input.className = 'peek-card-input';
      input.type = 'text';
      cardInput = input;
      card.append(input);
    }

    const done = doc.createElement('button');
    done.type = 'button';
    done.className = 'peek-card-done';
    done.textContent = 'Done';
    done.addEventListener('click', (ev) => {
      ev.preventDefault();
      // In-view double-submit guard: the card is torn down only when EXIT_HANDOFF
      // round-trips from the controller, so a fast double-click could otherwise
      // emit two shield.resume messages. (The controller's #settleHandoff is
      // idempotent, so this is belt-and-suspenders, but it keeps the view
      // self-consistent.) Disable the button + latch a flag on the first click.
      if (doneClicked) return;
      doneClicked = true;
      done.disabled = true;
      // Free-text card OR the unlocked field's value (selector case). The
      // controller drops it unless readBack (and never for password/OTP/cc).
      const value =
        cardInput?.value ??
        (handoffField instanceof HTMLInputElement || handoffField instanceof HTMLTextAreaElement
          ? handoffField.value
          : undefined);
      deps.sendToSw({ type: 'shield.resume', ...(value !== undefined ? { value } : {}) });
    });
    doneButton = done;
    card.append(done);

    shadow.append(card);
    cardEl = card;
    if (cardInput) cardInput.focus();
    else if (!handoffField) done.focus();
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
        setHostPhase('up');
        break;
      case 'LABEL':
        if (phase === 'up') setLabel(cmd.label);
        break;
      case 'LOWER':
        phase = 'down';
        teardownHost();
        break;
      case 'ENTER_HANDOFF':
        if (phase === 'up') {
          phase = 'handoff';
          buildHandoffCard(cmd.prompt, cmd.framing, cmd.selector);
          setHostPhase('handoff');
        }
        break;
      case 'EXIT_HANDOFF':
        if (phase === 'handoff') {
          teardownHandoffCard();
          phase = 'up';
          setHostPhase('up');
        }
        break;
    }
  };

  for (const type of CAPTURED_EVENTS) win.addEventListener(type, onCapture, { capture: true });
  deps.sendToSw({ type: 'shield.ready', generation: lastGen });

  const view: ShieldView = {
    apply,
    dispose(): void {
      for (const type of CAPTURED_EVENTS)
        win.removeEventListener(type, onCapture, { capture: true });
      teardownHost();
      phase = 'down';
    },
  };

  if (deps.exposeTestSeam) {
    view.__test = {
      handoffCard: () => cardEl,
      clickDone: (value) => {
        if (cardInput && value !== undefined) cardInput.value = value;
        doneButton?.click();
      },
      field: () => handoffField,
      phase: () => phase,
    };
  }

  return view;
}
