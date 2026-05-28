---
"@tracelane/core": patch
"@tracelane/report": patch
"@tracelane/wdio": patch
"@peekdev/cli": patch
"@peekdev/mcp": patch
---

Phase 4c QA fix loop #2 — alpha.3 republishes against the 2026-05-28 walk:

- **`@tracelane/wdio` rrweb recording empty** (T-9, showstopper) — the Service + hooks factory were re-injecting the recorder from `beforeCommand('url', ...)`, which fires BEFORE the navigation. The about-to-be-torn-down page got the bundle eval; the actual loaded page got nothing. Moved re-injection to `afterCommand('url', ...)` so rrweb lands on the new page. Verified end-to-end: the smoke fixture now captures 15+ events (FullSnapshot + interactions) where alpha.2 captured 0.
- **`@peekdev/cli peek init` writes empty `allowed_origins`** (P-10, showstopper) — the shipped `extension-ids.json` has `PLACEHOLDER_*` strings for all three slots, which `allowedOrigins()` correctly drops, leaving the native-host manifest with `"allowed_origins": []`. Chrome then silently blocks `chrome.runtime.connectNative()` from the unpacked extension. The wizard now prompts for the locally-loaded extension ID (validated against Chrome's 32-char a–p shape) and overrides `extensionIds.dev` before building the manifest. Empty input is allowed (skip — only useful with a populated CWS slot).
- **`@tracelane/wdio` `TraceLaneService` type incompatibility** (T-4) — the alpha.2 intersection fix on `options` was insufficient; the 2nd and 3rd constructor parameters were narrower than `Services.ServiceClass` requires. Widened to `Capabilities.ResolvedTestrunnerCapabilities` and `Options.Testrunner` so `services: [[TraceLaneService, { ... }]]` typechecks without `@ts-expect-error`.
- **`@peekdev/cli peek --version` stale literal** (P-8) — `CLI_VERSION` was a hardcoded `0.1.0-alpha.0` string; it drifted as the package bumped to alpha.1 / alpha.2. Now read from `package.json` at runtime via `createRequire`, mirroring the alpha.2 fix to peek-mcp's `SERVER_VERSION`. Regression test pins them together.
- **`@peekdev/extension` side-panel counters only updated on reload** (P-11) — the SW only injected the MAIN-world recorder from `chrome.tabs.onUpdated{ status: 'loading' }`. Enabling a site persisted the consent but left existing tabs un-instrumented until the user reloaded. Now also injects on `chrome.storage.onChanged` for `peek:enabledOrigins` — queries every currently-open tab of each newly-added origin and injects the recorder. Live counters now move as soon as the user enables a site and interacts with it.
- **QA doc column-name bug** (P-12, doc-only) — `docs/qa/peek-qa.md` E.3 / E.4 referenced `started_at` on the `sessions` table; the actual column is `created_at`. Updated.

Note: `@peekdev/extension` does not publish to npm (it's the unpacked / CWS-distributed Chrome extension), so it's not in the version bump list above — the P-11 fix is folded into the same alpha.3 wave for the maintainer's source tree but doesn't trigger an npm publish.
