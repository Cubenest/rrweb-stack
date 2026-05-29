---
"@peekdev/extension": patch
---

Phase 4c QA loop #5 — P-17 fix: Deep capture toggle OFF now revokes for
every tab of the origin, not just the active one.

The MV3 service worker's in-memory `#attached` Map gets wiped on the
~30s inactivity teardown, but Chrome-level debugger attachments survive
the SW restart (yellow banners persist). The previous `detachOrigin`
iterated `#attached`, so post-restart it became a no-op and the
"peek is debugging this browser" banners stuck on background tabs even
after the user toggled Deep capture off — a privacy regression.

Now:
- `detach(tabId)` ALWAYS calls `chrome.debugger.detach` and swallows
  the "Debugger is not attached" + "tab closed" errors.
- `detachOrigin(origin, tabIds)` accepts a caller-supplied list of
  tab IDs. The SW enumerates `chrome.tabs.query({})` and filters by
  origin, so coverage is independent of whatever the manager's
  in-memory state remembered.

Private package — bump only updates `version_name` in the built
manifest so maintainers building locally can confirm their build
includes the fix.
