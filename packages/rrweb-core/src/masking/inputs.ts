// Input-element value masking.

import { elementMatchesAnyMaskClass } from './selectors';

/**
 * Hard-masked input types — always returned as asterisks regardless of
 * surrounding selectors, parent attributes, or config. This is the privacy
 * floor: even if every other guard misconfigures, a password field's
 * value never leaves the device.
 */
const HARD_MASKED_TYPES: ReadonlySet<string> = new Set(['password', 'email', 'tel']);

/**
 * Return the maskable representation of an input's value.
 *
 *   1. If `type` is password/email/tel: return all `*` of the same length
 *      (hard mask; no opt-out).
 *   2. Else if the element or any ancestor carries a mask/block class or
 *      Datadog privacy attribute: return all `*` of the same length.
 *   3. Else: return the actual value.
 *
 * The asterisk-of-same-length convention matches PostHog/Sentry; the
 * length leak is intentional so replay still shows "something was typed
 * here" without revealing what.
 */
export function maskInputValue(el: HTMLInputElement | HTMLTextAreaElement): string {
  const value = el.value ?? '';

  // `type` only exists on HTMLInputElement; textareas always fall through
  // to the class/attribute check.
  const type = 'type' in el && typeof el.type === 'string' ? el.type.toLowerCase() : '';

  if (HARD_MASKED_TYPES.has(type)) {
    return '*'.repeat(value.length);
  }

  if (elementMatchesAnyMaskClass(el)) {
    return '*'.repeat(value.length);
  }

  return value;
}
