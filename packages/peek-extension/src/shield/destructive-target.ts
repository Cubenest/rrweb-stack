import { isDestructive } from '../permissions/destructive';

/** Controls a human click lands on. input[type=submit|button|image] carry their label in `value`. */
const CLICKABLE_SELECTOR =
  'button, a[href], [role="button"], input[type="submit"], input[type="button"], input[type="image"], summary';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, legend';

export interface DestructiveHit {
  /** The clickable ancestor of the event target. */
  readonly el: Element;
  /** The matched base destructive term (from the controlled term list). */
  readonly term: string;
}

/**
 * The nearest heading that PRECEDES `el` in document order within `root`, or null.
 * Position-aware: a heading that sits *after* the control (e.g. the next section's
 * title) does not describe it, so it is never returned. Empty headings are skipped.
 */
function precedingHeadingWithin(root: ParentNode, el: Element): string | null {
  let found: string | null = null;
  for (const h of Array.from(root.querySelectorAll(HEADING_SELECTOR))) {
    if ((h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) {
      const t = (h.textContent ?? '').trim();
      if (t.length > 0) found = t;
    }
  }
  return found;
}

/**
 * If `target` sits on/in a clickable control whose accessible label looks destructive
 * (base destructive terms only — the shield has no access to the user policy), return the
 * control + matched term. Pure DOM read; never mutates; tolerant of odd input.
 */
export function destructiveClickTarget(target: EventTarget | null): DestructiveHit | undefined {
  if (!(target instanceof Element)) return undefined;
  const el = target.closest(CLICKABLE_SELECTOR);
  if (!el) return undefined;

  const ownText = (el.textContent ?? '').trim();
  const inputValue = el instanceof HTMLInputElement ? (el.value ?? '').trim() : '';
  const text = ownText.length > 0 ? ownText : inputValue;
  const ariaLabel = el.getAttribute('aria-label');

  // Prefer the nearest preceding heading inside the control's region; else fall back to the
  // nearest preceding heading in the whole document. (The destructive-override gate in
  // dispatcher.ts derives the same text/aria/heading signals; the gate is intentionally left
  // unchanged — this advisory cue just uses a more position-precise heading lookup.)
  const region = el.closest('section, fieldset, article, [role="region"]');
  let nearbyHeading = region ? precedingHeadingWithin(region, el) : null;
  if (nearbyHeading === null) {
    nearbyHeading = precedingHeadingWithin(el.ownerDocument ?? document, el);
  }

  const result = isDestructive({
    text: text.length > 0 ? text : null,
    ariaLabel,
    nearbyHeading: nearbyHeading && nearbyHeading.length > 0 ? nearbyHeading : null,
  });
  return result.matched && result.term ? { el, term: result.term } : undefined;
}
