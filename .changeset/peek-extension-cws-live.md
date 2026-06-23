---
"@peekdev/cli": patch
"@peekdev/mcp": patch
---

docs: the peek Chrome extension is now live on the Chrome Web Store.

Install guidance now leads with the Chrome Web Store listing
(<https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb>)
as the primary path, with "load unpacked from `packages/peek-extension/chrome-mv3/`"
demoted to a contributor/local-build fallback. The `@peekdev/extension` package's
npm status is unchanged — it remains `private` and is not published to npm; only
the Chrome-Web-Store availability wording changed. Docs-only; no code change.
