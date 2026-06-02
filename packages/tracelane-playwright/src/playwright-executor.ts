// Adapts a Playwright `Page` to @tracelane/core's `BrowserExecutor` (ADR-0004).
//
// THE SEAM (plan Task 5): core's `execute<T>(fn, ...args)` is VARIADIC — it
// `.toString()`-serializes `fn` and passes every positional arg through. But
// Playwright's `page.evaluate(pageFunction, arg)` takes exactly ONE serializable
// arg. We bridge the two by packing `{ body: fn.toString(), args }` into that
// single arg and, in-page, rebuilding the function from its source and
// `.apply()`-ing it to the unpacked args. This preserves the WDIO-style
// "self-contained fn + explicit args" contract that core relies on.
//
// CDP (network capture) is Chromium-only: it requires a CDPSession, obtained by
// the caller via `context.newCDPSession(page)` and passed in. Without it, `cdp`
// and `on` throw — the session degrades to rrweb+console (mirrors WDIO's
// degrade path). page.evaluate-based `execute` works on all browsers.

import type { CDPSession, Page } from '@playwright/test';
import type { BrowserExecutor } from '@tracelane/core';

/** What we pack into Playwright's single `page.evaluate` arg. */
interface PackedCall {
  body: string;
  args: unknown[];
}

/**
 * Build a {@link BrowserExecutor} over a Playwright `Page`. Pass an optional
 * `cdp` (`CDPSession`) to enable the CDP-backed network capture path on
 * Chromium.
 */
export function createPlaywrightExecutor(page: Page, cdp?: CDPSession): BrowserExecutor {
  return {
    async execute<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> {
      return page.evaluate<T, PackedCall>(
        (packed) => {
          // Rebuild the serialized fn in-page and apply the unpacked args. The
          // body is `fn.toString()`, so `(body)` is a valid function expression.
          // biome-ignore lint/security/noGlobalEval: in-page fn reconstruction is the documented adapter seam (PRD §A.4)
          const f = new Function(`return (${packed.body}).apply(null, arguments[0]);`);
          return f(packed.args) as T;
        },
        { body: fn.toString(), args },
      );
    },

    async executeAsync<T>(): Promise<T> {
      // The recorder (ADR-0006) only ever uses `execute`; WebDriver-style async
      // scripts have no analogue under Playwright (page.evaluate already awaits
      // a returned Promise). Surface a clear error if anything reaches for it.
      throw new Error('executeAsync is not used by the recorder under Playwright');
    },

    async cdp(domain: string, command: string, params?: Record<string, unknown>): Promise<unknown> {
      if (!cdp) throw new Error('CDP not attached (Chromium-only network capture)');
      // Playwright's CDPSession.send is strongly typed over the CDP method
      // union; the BrowserExecutor surface is string-based, so cast at the seam.
      return cdp.send(`${domain}.${command}` as never, params as never);
    },

    on(event: string, handler: (params: unknown) => void): void {
      if (!cdp) throw new Error('CDP not attached (Chromium-only network capture)');
      cdp.on(event as never, handler as never);
    },
  };
}
