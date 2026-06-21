---
"@peekdev/extension": patch
---

Fix a destructive-action override bypass at permission Level 4 (YOLO).

The service worker resolves an action's destructive-matcher signals by injecting
`resolveTargetInPage` into the page's MAIN world via
`chrome.scripting.executeScript`. The args were passed positionally as
`[selector, nth, ref]`, leaving `nth`/`ref` as `undefined` for an ordinary
click. `executeScript` rejects a non-JSON-serializable `undefined` in `args` and
throws; the dep's `catch` fails open to "no signals", so the destructive matcher
never ran. As a result a Level-4 `Delete`/`Pay`/`Transfer`/etc. action — by
`ref` **or** `selector` — was auto-allowed with no confirm banner, defeating the
destructive override (which is supposed to always prompt, even at Level 4).

The injected args are now built by a new `resolveTargetArgs` helper that coerces
the optionals to JSON-serializable sentinels `resolveTargetInPage` already treats
as "absent" (`nth` 0 → first match, `ref` '' → skip the ref-registry branch), so
the call no longer throws and the matcher inspects the real target element.

The unit and Chromium e2e suites missed this because they inject the resolver
function directly, bypassing real `executeScript` arg serialization; it surfaced
in the R2 live MCP→native-host→service-worker round-trip test (§C2). A regression
test now asserts the injected args are always JSON-serializable. Read paths
(`get_page_view`, `get_element_detail`) and Level&nbsp;1–3 gating are unaffected.
