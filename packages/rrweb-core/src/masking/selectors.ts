// Compatibility selectors inherited from the rrweb ecosystem.
// Recording libraries (PostHog, Sentry, upstream rrweb, Datadog) have each
// established their own DOM hint conventions for "don't capture this".
// `@cubenest/rrweb-core` honors all of them so apps that already annotated
// their DOM for one vendor don't have to re-annotate.
//
// See ADR-0002 for the rationale and source links.

/**
 * Selector families recognized by the substrate. Frozen at module load to
 * prevent runtime tampering — masking config is a privacy boundary and we
 * don't want anywhere in the stack to be able to mutate it.
 */
export const COMPAT_SELECTORS = Object.freeze({
  /**
   * Native `<org>`-prefixed family (cubenest).
   * Apps embedding the substrate directly should prefer these.
   */
  cubenest: Object.freeze({
    block: 'cubenest-block',
    mask: 'cubenest-mask',
    ignore: 'cubenest-ignore',
    dataAttrs: Object.freeze([
      'data-cubenest-mask',
      'data-cubenest-block',
      'data-cubenest-ignore',
    ]) as readonly string[],
  }),

  /**
   * PostHog session-replay conventions.
   * Sources: posthog-js README and `session-recording.ts`.
   */
  posthog: Object.freeze({
    block: 'ph-no-capture',
    mask: 'ph-mask',
    ignore: 'ph-ignore-input',
    dataAttrs: Object.freeze(['data-ph-capture-attribute']) as readonly string[],
  }),

  /**
   * Sentry session-replay conventions.
   * Sources: @sentry/replay docs.
   */
  sentry: Object.freeze({
    block: 'sentry-block',
    mask: 'sentry-mask',
    ignore: 'sentry-ignore',
    dataAttrs: Object.freeze([
      'data-sentry-block',
      'data-sentry-mask',
      'data-sentry-ignore',
    ]) as readonly string[],
  }),

  /**
   * Upstream rrweb conventions (the `rr-*` prefix).
   * Sources: rrweb-snapshot README.
   */
  rrweb: Object.freeze({
    block: 'rr-block',
    mask: 'rr-mask',
    ignore: 'rr-ignore',
    dataAttrs: Object.freeze([
      'data-rr-block',
      'data-rr-mask',
      'data-rr-ignore',
    ]) as readonly string[],
  }),

  /**
   * Datadog RUM session-replay conventions. Datadog uses data-attribute
   * values rather than classes; we expose the attribute names plus the
   * privacy values they accept.
   * Sources: Datadog RUM docs.
   */
  datadog: Object.freeze({
    // Datadog has no class-based block/mask/ignore; we mirror the shape
    // by surfacing the attribute names. Consumers walking the tree look
    // for `data-dd-privacy=hidden` (block) or `=mask` (mask).
    block: 'data-dd-privacy="hidden"',
    mask: 'data-dd-privacy="mask"',
    ignore: 'data-private',
    dataAttrs: Object.freeze(['data-private', 'data-dd-privacy']) as readonly string[],
  }),
});

export type CompatSelectorFamily = keyof typeof COMPAT_SELECTORS;

/**
 * Flat list of class names that mean "block this element entirely" across
 * all families. Internal helper used by {@link elementMatchesAnyMaskClass}.
 */
const ALL_BLOCK_CLASSES: readonly string[] = Object.freeze([
  COMPAT_SELECTORS.cubenest.block,
  COMPAT_SELECTORS.posthog.block,
  COMPAT_SELECTORS.sentry.block,
  COMPAT_SELECTORS.rrweb.block,
]);

/**
 * Flat list of class names that mean "mask this element's value". Datadog
 * is omitted because it uses attributes, not classes.
 */
const ALL_MASK_CLASSES: readonly string[] = Object.freeze([
  COMPAT_SELECTORS.cubenest.mask,
  COMPAT_SELECTORS.posthog.mask,
  COMPAT_SELECTORS.sentry.mask,
  COMPAT_SELECTORS.rrweb.mask,
]);

/**
 * Walks `el` and its ancestors, returning true if any node carries a class
 * from a known mask/block family OR a Datadog `data-dd-privacy` /
 * `data-private` attribute. Internal — used by `maskInputValue`.
 */
export function elementMatchesAnyMaskClass(el: Element | null): boolean {
  let node: Element | null = el;
  while (node !== null) {
    // Class-based matches.
    if (node.classList !== undefined) {
      for (const cls of ALL_MASK_CLASSES) {
        if (node.classList.contains(cls)) return true;
      }
      for (const cls of ALL_BLOCK_CLASSES) {
        if (node.classList.contains(cls)) return true;
      }
    }
    // Attribute-based matches (cubenest data-attrs + Datadog).
    if (typeof node.hasAttribute === 'function') {
      for (const attr of COMPAT_SELECTORS.cubenest.dataAttrs) {
        if (node.hasAttribute(attr)) return true;
      }
      if (node.hasAttribute('data-private')) return true;
      const ddPrivacy = node.getAttribute('data-dd-privacy');
      if (ddPrivacy === 'hidden' || ddPrivacy === 'mask') return true;
    }
    node = node.parentElement;
  }
  return false;
}
