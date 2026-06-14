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
