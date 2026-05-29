# @peekdev/extension

## 0.1.0-alpha.3

### Patch Changes

- Phase 4c QA loop #5 — P-17 fix: Deep capture toggle OFF now revokes for
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

## 0.1.0-alpha.2

### Patch Changes

- Phase 4c QA loop #3 — two targeted fixes from the maintainer's alpha.3 walk:
  - **P-13** (`@peekdev/cli`): `peek init` is now idempotent. Before prompting
    for the unpacked extension ID, it reads the first existing native-host
    manifest's `allowed_origins`, extracts any previously-saved dev ID via the
    new `extractDevId()` helper, and offers to reuse it. Decline falls through
    to the original prompt. Confirms B.4 idempotency of the Phase 4c QA
    checklist.
  - **P-14** (`@peekdev/extension`): the `debugger` permission moved from
    `optional_permissions` to required `permissions`. Chrome 121+ banned
    `debugger` from MV3 optional permissions; the entry was silently dropped
    at load, breaking Deep capture (Group H) at install. The install card now
    shows the read-and-modify-all-data warning; per-origin Deep capture
    control via the side-panel toggle (ADR-0010) is unchanged.

  `@peekdev/extension` stays `private: true` — the manifest fix ships only to
  maintainers who rebuild locally and load unpacked. CWS submission remains
  Phase 5.

## 0.1.0-alpha.1

### Patch Changes

- Updated dependencies
  - @cubenest/rrweb-core@0.1.0-alpha.1
