# @peekdev/extension

## 0.1.0-alpha.17

### Patch Changes

- a52931a: Windows-hardening (Phase B): three fixes for installing and connecting the peek native host on Windows.
  - **Surface `reg.exe` failures instead of swallowing them** (`@peekdev/mcp`). The default registry-write sink ran `reg.exe add … /f` with `stdio: 'ignore'`, so when the HKCU write failed (locked/redirected hive, restricted token, EACCES) its stderr was discarded and the postinstall log showed a useless bare "Command failed". It now pipes stderr and rethrows a message that folds in `reg.exe`'s own stderr plus the exit status, so the per-target error the user sees is actionable.
  - **Resolve the home directory via `os.homedir()` in postinstall** (`@peekdev/mcp`). The postinstall path derived `home` from `process.env.HOME ?? process.env.USERPROFILE`, which on Git Bash for Windows picks up a POSIX `$HOME` (`/c/Users/jane`) that diverges from where Chrome/Edge actually read the host manifest. It now uses `os.homedir()` (which returns `%USERPROFILE%` on Windows), matching the `peek` CLI, and drops the empty-string fallback.
  - **Make the "run `peek init`" setup hint reachable from a stuck reconnect** (`@peekdev/extension`). When `connectNative` threw because the native host was never registered, the background state machine parked in `reconnecting` and never returned to `disconnected`, so the side panel showed a perpetual "Reconnecting…" pill and the setup hint (previously gated on `disconnected` only) was unreachable. The service worker now tracks consecutive failed reconnect attempts and the side panel surfaces the same "run `peek init`" guidance once the reconnect has been stalling long enough that the host is almost certainly unregistered.

- 4e59c1e: Fix the native-host "run `peek init`" setup hint never appearing for an
  unregistered host.

  An unregistered native host on Chrome does not throw synchronously from
  `connectNative` — it returns a port that immediately fires `onDisconnect`
  ("host not found"), a disconnect-storm. The reconnect-attempt counter was reset
  the instant a port handle appeared, so the stall threshold was never reached and
  the side panel showed a perpetual "Reconnecting…" with no guidance. The reset is
  now deferred behind a `CONNECTION_HELD_MS` window — only a connection that
  actually holds clears the counter — so a storm accumulates attempts and surfaces
  the setup hint. Adds a Playwright e2e covering the unregistered-host scenario.

## 0.1.0-alpha.16

### Patch Changes

- 4d3f36d: Part 2 — assisted-apply: add set_intent (agent-set control-shield banner string)
  and request_user_input scope:'page' (full-page takeover for CAPTCHAs / native
  widgets / the final review-and-submit, atop the existing field-scope handoff),
  plus a supervised assisted-apply recipe (draft). page-scope inherits the handoff
  recording-suspension; the recipe states the LinkedIn-ToS + recording-residual
  honesty plainly.
- 42c948b: Add the Level-4 control shield: when an origin is in Auto (Level 4) and the
  native host is connected, peek shows a closed-shadow overlay (border + banner +
  scrim) that blocks the human's real input while peek's synthetic actions pass,
  with a one-click Stop / Esc that hard-drops the origin to Level 1.
- 877d35a: Add the input handoff (request_user_input): while the Level-4 control shield is
  up, the agent can pause and hand the keyboard back to the user for one editable,
  non-destructive field (or a free-text prompt), then resume. The returned value
  is opt-in (readBack) and never for password/OTP/cc fields; rrweb forwarding is
  suspended for the tab during the handoff (incremental channel; the FullSnapshot
  residual is documented). Approver is `user`; audit records prompt + selector only.

## 0.1.0-alpha.15

### Patch Changes

- aa79091: feat: implement the Level-2 "Suggest" tier — MCP-driven DOM highlight overlay

  peek-mcp:
  - `suggest_element` (selector, optional label) — draws a non-destructive highlight overlay on an element in the live browser, to point something out without changing the page. Available at per-origin permission Level 2 (Suggest) and above.
  - `clear_highlight` — removes the active overlay. Idempotent.
  - New `highlight` / `clear_highlight` action schemas; new honest `level-2-suggest` audit approver.

  Extension:
  - Self-contained MAIN-world `applyHighlight` / `clearHighlight` overlay functions (fixed-position ring + optional label badge, re-anchored on scroll/resize, replace-on-reapply, persists until cleared).
  - The SW auto-allows highlight/clear_highlight at Level 2+ via a dedicated non-mutating path — no destructive check, no confirm banner, no token. Levels 0/1 deny.

  This activates the previously-reserved Level-2 "Suggest-only" tier.

## 0.1.0-alpha.14

### Patch Changes

- 209c1b3: feat: implement all remaining execute_action verbs (back/forward/reload/waitFor/screenshot/enter/dblclick) and fix screenshot capture

  Extension:
  - `back` / `forward` / `reload` — history navigation verbs in the MAIN-world dispatcher
  - `waitFor` — MutationObserver + timeout race; waits for a selector to attach or a pure delay
  - `screenshot` — CDP `Page.captureScreenshot` via the already-declared `debugger` permission (replaces `captureVisibleTab` which requires `<all_urls>` / an `activeTab` user gesture unavailable in the MCP→native-host→SW call path)
  - `enter` — dispatches keydown/keypress/keyup with key=Enter on a selector or the active element; triggers native form submission in most frameworks
  - `dblclick` — dispatches a `dblclick` MouseEvent on a resolved selector

  peek-mcp:
  - Adds `EnterActionSchema` and `DblClickActionSchema` to the Zod `ActionSchema` union so the MCP tool surfaces both verbs to AI clients
  - `writeScreenshotFile`: host-socket spills the screenshot `dataUrl` to `~/.peek/screenshots/<requestId>.png` (0600) and returns a path pointer instead of a multi-MB base64 blob in the MCP context

## 0.1.0-alpha.13

### Patch Changes

- 3572a6b: fix: self-contain the MAIN-world injected functions so `execute_action` can drive the DOM

  `dispatchAction` and `resolveTarget` are passed by reference to
  `chrome.scripting.executeScript({ world: 'MAIN', func })`, which serializes only
  each function's own source into the page. Both called a module-scope
  `resolveElement` helper that did not travel with the serialized function, so
  every click / type / scroll-into-view action threw `ReferenceError` in the page
  and silently failed with `"no result from MAIN-world dispatch"` — the write-path
  never actually drove the browser. Inlined `resolveElement` as a nested function
  inside both injected functions (each now references only its params + page
  globals) and added a serialization regression test that reconstructs the
  function from `.toString()` in a helper-free scope. Verified live: the first
  successful end-to-end `execute_action`.

## 0.1.0-alpha.12

### Patch Changes

- 58b4460: Adds a visible recording-active indicator: an always-on toolbar badge shows when peek is capturing, plus a default-on in-page glow rendered inside a closed shadow root (excluded from peek's own rrweb capture). Recording state is driven by the service worker per tab. A "Show recording border" toggle in the side panel hides the in-page glow while the badge stays visible.

## 0.1.0-alpha.11

### Patch Changes

- Updated dependencies [6ca4c92]
  - @cubenest/rrweb-core@0.1.0-alpha.6

## 0.1.0-alpha.10

### Minor Changes

- 4633f96: Wire the execute_action write-path end-to-end: a LocalSocketHostBridge (MCP process) ↔ HostSocketServer (native host) over ~/.peek/host.sock, a MAIN-world action dispatcher (click/type/navigate/scroll), a side-panel confirm banner, and confirmToken consumption that skips the banner. The write PATH is now implemented end to end — but write access stays OFF by default. peek remains read-only (Level 1) for every origin until you opt in per-origin to Level 3 (act-with-confirm) or Level 4 (YOLO). At Level 3 every action surfaces the side-panel confirm banner before it runs (Allow once / Always for this site / Deny); a prior request_authorization issues a one-shot confirmToken, bound to the exact action, that lets the next execute_action skip the banner. The destructive-action blocklist overrides every level. Level 2 highlight and the remaining actions are queued.

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies [6eb4046]
  - @cubenest/rrweb-core@0.1.0-alpha.5

## 0.1.0-alpha.8

### Patch Changes

- Updated dependencies [96a4b24]
  - @cubenest/rrweb-core@0.1.0-alpha.4

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies [5e5674b]
  - @cubenest/rrweb-core@0.1.0-alpha.3

## 0.1.0-alpha.6

### Patch Changes

- 12b80b3: Phase 3 of the framework-agnostic network plugin rollout — peek-extension
  migrates off its hand-rolled fetch + XHR wrappers to the plugin in
  @cubenest/rrweb-core@alpha.2.

  @peekdev/extension:
  - MAIN-world recorder (recorder-entry.ts) registers getRecordNetworkPlugin
    in record()'s plugins array. Defaults stay conservative (bodies +
    headers off; PerformanceObserver path on) — peek's privacy posture is
    unchanged, and the plugin's default maskRequestFn already pipes through
    redactBody / redactNetworkHeaders / URL-redaction.
  - ~168 LOC of net-capture.ts manual fetch + XHR helpers DELETED (the
    file itself is gone). Recorder-entry.ts loses ~140 LOC of the inline
    `window.fetch =` / `XMLHttpRequest.prototype.{open,send,setRequestHeader} =`
    wrapper shim that's now superseded by the plugin.
  - SW relay (entrypoints/background.ts + new background/network-plugin-synth.ts)
    gains a synthesizer that converts plugin events (EventType.Plugin /
    'rrweb/network@1') into the existing NetMessage envelope shape,
    double-writing onto the network.append channel so peek-mcp's
    get_session_network_errors MCP tool keeps returning rows for new
    sessions. The synthesizer is marked for removal in alpha.10 when the
    read-path migrates to walk the rrweb event stream directly (the same
    extractor @tracelane/report's panels.ts already uses).

  @peekdev/mcp:
  - No schema change. The network_events table + the network.append ingest
    handler still take their input from the SW relay's NetMessage
    envelopes — now synthesized from plugin events instead of forwarded
    from the hand-rolled wrappers. The wire shape is preserved by design;
    get_session_network_errors returns identical row shapes for sessions
    captured via plugin vs the legacy fetch+XHR path.

  Closes Task #72 (and Task #71, the umbrella framework-agnostic rrweb
  network plugin work spanning phase 1 = substrate, phase 2 = tracelane,
  phase 3 = peek).

## 0.1.0-alpha.5

### Patch Changes

- Updated dependencies [7100b3f]
  - @cubenest/rrweb-core@0.1.0-alpha.2

## 0.1.0-alpha.4

### Patch Changes

- 15e4f8c: Phase 4c alpha.7 cleanups — close the 3 remaining annoyances from the
  manual QA walk (docs/qa/findings-2026-05-28.md):
  - J.6 (peek-extension + peek-mcp): rrweb recorder now emits a fresh
    FullSnapshot every 2 minutes (checkoutEveryNms: 120_000) and every
    5000 events. Bounds the look-back window for get_dom_snapshot so AI
    tools get a reconstructed DOM at the error timestamp even when the
    error fires deep into a long-running session.
  - K.2 (peek-cli + peek-mcp): `peek sessions export --format playwright`
    now wires through to the same `generatePlaywrightRepro` code path that
    the MCP `generate_playwright_repro` tool uses. CLI + AI consumers get
    identical output for the same session. peek-mcp gains
    `./mcp/playwright-repro` and `./mcp/event-blobs` subpath exports.
  - P-18 (peek-cli): `peek sessions list --json` outputs machine-readable
    JSON; `peek sessions list --help` prints usage and exits 0. parseArgs
    no longer crashes on unknown flags. Same `--help` treatment extended
    to show / export / delete / audit subcommands; each has a
    subcommand-specific usage block.

  peek-extension stays private (no npm publish); peek-cli and peek-mcp
  republish via OIDC.

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
