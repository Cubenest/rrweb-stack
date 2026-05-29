// Monkey-patch utility for replacing global functions (fetch, XHR.open, …)
// with our wrappers and restoring them on teardown.
//
// Adapted from PostHog's rrweb-plugins/patch.ts (Apache-2.0), which was
// itself copied from rrweb-io/rrweb's utils.ts, which was copied from
// Sentry's @sentry/utils/object.ts. The chain of vendoring is documented
// in NOTICE.
//
// Trimmed differences vs PostHog's version:
//   - Drops the `@posthog/core` `isFunction` import; inlines the typeof
//     check (3 LOC).
//   - Renames the non-enumerable marker to `__cubenest_wrapped__` so we
//     don't claim a property name PostHog also uses (defensive — avoids
//     accidental double-wrap detection if both libraries ever sit in the
//     same global).

const isFunction = (v: unknown): v is (...args: unknown[]) => unknown => typeof v === 'function';

/**
 * Replace `source[name]` with `replacement(original)` and return a
 * disposer that restores the original.
 *
 * Returns a no-op disposer if:
 *   - `name` is not in `source` (caller may be running in an env without
 *     fetch/XHR, e.g. a Node target);
 *   - the replacement throws on definition (some browsers throw on
 *     `defineProperties` over re-defined globals — Sentry hit this on
 *     XMLHttpRequest in older Safari);
 */
export function patch(
  source: { [key: string]: unknown },
  name: string,
  replacement: (original: unknown) => unknown,
): () => void {
  try {
    if (!(name in source)) {
      return () => {
        /* no-op */
      };
    }

    const original = source[name];
    const wrapped = replacement(original);

    // Attach a non-enumerable marker so external code can detect that the
    // function has been wrapped (matches Sentry's pattern). We need a
    // function with a prototype slot for `defineProperties` to work.
    if (isFunction(wrapped)) {
      // biome-ignore lint/suspicious/noExplicitAny: prototype slot assignment
      (wrapped as any).prototype = (wrapped as any).prototype || {};
      Object.defineProperties(wrapped, {
        __cubenest_wrapped__: {
          enumerable: false,
          value: true,
        },
      });
    }

    source[name] = wrapped;

    return () => {
      source[name] = original;
    };
  } catch {
    // Some browsers throw if a global has already been redefined
    // (multi-wrap scenario). Returning a no-op disposer matches PostHog
    // and Sentry — silently degrade rather than break the host page.
    return () => {
      /* no-op */
    };
  }
}
