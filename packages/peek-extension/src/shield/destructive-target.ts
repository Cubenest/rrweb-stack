import { isDestructive } from '../permissions/destructive';

/** Controls a human click lands on. input[type=submit|button|image] carry their label in `value`. */
const CLICKABLE_SELECTOR =
  'button, a[href], [role="button"], input[type="submit"], input[type="button"], input[type="image"], summary';

export interface DestructiveHit {
  /** The clickable ancestor of the event target. */
  readonly el: Element;
  /** The matched base destructive term (from the controlled term list). */
  readonly term: string;
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

  let nearbyHeading: string | null = null;
  const scoped = el
    .closest('section, fieldset, article, [role="region"]')
    ?.querySelector('h1, h2, h3, h4, h5, h6, legend');
  if (scoped?.textContent) {
    nearbyHeading = scoped.textContent.trim();
  } else {
    const doc = el.ownerDocument ?? document;
    for (const h of Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6, legend'))) {
      if ((h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) {
        nearbyHeading = (h.textContent ?? '').trim();
      }
    }
  }

  const result = isDestructive({
    text: text.length > 0 ? text : null,
    ariaLabel,
    nearbyHeading: nearbyHeading && nearbyHeading.length > 0 ? nearbyHeading : null,
  });
  return result.matched && result.term ? { el, term: result.term } : undefined;
}
