import type { ViewCommand } from '../shield/protocol';

/**
 * Pure helper for the relay-side handoff recording-suspension (Plan B, design
 * §6/§9/§10).
 *
 * The relay batches rrweb events and flushes on a ~1000ms interval, so an event
 * the user types DURING a handoff would otherwise sit in the batch and be
 * forwarded on the first flush AFTER the phase flips back to `up` — a
 * post-resume leak. We therefore DROP rrweb events at production time (the
 * relay's `rrwebBatch.add` intake), not at SW receipt, so they're never
 * buffered.
 *
 * Console-plugin events ride a separate masked channel (`consoleBatch`) and are
 * unconditional — they are not the page's keystroke surface — so they are never
 * dropped here.
 */
export function shouldDropRrwebDuringHandoff(inHandoff: boolean, isConsoleEvent: boolean): boolean {
  return inHandoff && !isConsoleEvent;
}

/**
 * Next value of the relay's `shieldInHandoff` flag given the current value and an
 * incoming ViewCommand kind. `ENTER_HANDOFF` suspends recording; `EXIT_HANDOFF`,
 * `LOWER`, AND `RAISE` all return the view to a recording-active state, so they
 * clear it; `LABEL` leaves it unchanged.
 *
 * `RAISE` MUST clear the flag: the controller re-raises during a pending handoff
 * (reconcile after SW eviction / host reconnect — controller `#raise` aborts the
 * handoff and sends `RAISE`, not `EXIT_HANDOFF`). If `RAISE` didn't clear the
 * flag, recording would stay silently suspended for the tab until a reload.
 */
export function nextHandoffFlag(current: boolean, kind: ViewCommand['kind']): boolean {
  switch (kind) {
    case 'ENTER_HANDOFF':
      return true;
    case 'EXIT_HANDOFF':
    case 'LOWER':
    case 'RAISE':
      return false;
    default:
      return current; // LABEL — no phase change
  }
}
