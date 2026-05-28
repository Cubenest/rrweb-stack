# peek manual QA — fresh-install walk

Read [`README.md`](./README.md) first. Heavier than tracelane because peek's surface is wider: extension + CLI + MCP server + native host + AI client. Plan ~2 hours.

Conventions for Status:

- ✅ Pass · 🔴 Showstopper · 🟡 Annoyance · 🟢 Polish · ⏸ Blocked/Phase-5-stub

Before starting, do the clean-shell scrub from the [runbook](./README.md#clean-shell-do-this-first). The `~/.peek/` directory and native-host manifests must not exist.

> **Reality check on the CLI surface.** The docs at `apps/peek-docs/src/pages/getting-started.astro` mention `peek install` as a separate native-host install step. **The actual CLI does not have a `peek install` subcommand.** Native-host install happens INSIDE `peek init` (it asks for consent then writes manifests via `installManifests()`). Treat that as a documented `🟡` finding when you walk Group B, or fold it into a doc-fix later — your call.

---

## Group A — `peek-mcp` standalone

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| A.1 | Server starts on `npx` and answers `initialize` | `npx -y @peekdev/mcp` in a fresh shell. Process starts, waits on stdin. In another shell pipe: `printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"qa","version":"0.0.0"}}}\n' \| npx -y @peekdev/mcp` (or use Inspector — `npx -y @modelcontextprotocol/inspector npx -y @peekdev/mcp`). **Expected:** a JSON-RPC response with `serverInfo.name = "peek"`. | |
| A.2 | Tool list has the 10 expected names | In the Inspector (easier than crafting JSON) — list tools. **Expected:** exactly these 10: `list_recent_sessions`, `get_session_summary`, `get_session_console_errors`, `get_session_network_errors`, `get_user_action_before_error`, `generate_playwright_repro`, `get_dom_snapshot`, `query_dom_history`, `request_authorization`, `execute_action`. The last two are write-class (Level-3+); the first eight are read. | |
| A.3 | Version reporting | `npx -y @peekdev/mcp --version` — **NOTE: peek-mcp does NOT implement `--version`.** Expected to ignore the flag and start the server. The bin's version lives in `package.json` (`0.1.0-alpha.1`). Status this as ⏸ if the flag does nothing — that's the actual behavior. If we want a `--version` flag, that's a 🟢. | |
| A.4 | Native-host install via the CLI (not the MCP bin) | **The peek-mcp binary itself does NOT have an `--install-native-host` flag.** Install runs via `peek init` (see Group B). Skip this row, or mark ⏸ with the note "no standalone install flag — by design, since install needs user consent". | |
| A.5 | Manifest landing location after `peek init` | After running Group B.3 below: `ls ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/`. **Expected:** `com.peekdev.host.json` exists. (Linux: `~/.config/google-chrome/NativeMessagingHosts/`. Windows: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.peekdev.host` registry key.) | |
| A.6 | Manifest content sanity | `cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.peekdev.host.json`. **Expected:** `name = "com.peekdev.host"`, `type = "stdio"`, `allowed_origins` includes the dev-build extension ID(s) from `packages/peek-mcp/src/native-host/extension-ids.json`, `path` points at a `peek-mcp` shim. | |

## Group B — `peek-cli`

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| B.1 | Install and PATH | `npm install -g @peekdev/cli` (or `pnpm dlx @peekdev/cli status` for a one-shot). **Expected:** `which peek` returns a path. `peek --version` prints `0.1.0-alpha.1`. | |
| B.2 | `peek status` baseline | `peek status`. **Expected:** reports DB path (`~/.peek/sessions.db`), schema version (or "not initialized" if the host hasn't run yet — fine on a clean shell), native-host install state (per browser), extension state (if known). NOT expected: a crash. | |
| B.3 | `peek init` configures Claude Code | `peek init`. Wizard runs. Auto-detects `~/.claude.json`. Prompts to add the `peek` MCP server entry. Accept. Then prompts for browser selection (Chrome / Edge / Brave / Arc / etc.). Pick Chrome. Accept the native-host write. **Expected on exit:** `~/.claude.json` contains `mcpServers.peek = { command: "npx", args: ["-y", "@peekdev/mcp"] }` AND `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.peekdev.host.json` exists. | |
| B.4 | `peek init` is idempotent | Run `peek init` a second time. **Expected:** detects the existing Claude entry and the existing manifest, skips both (or offers an explicit re-install option). No JSON corruption. | |
| B.5 | Multi-client (if installed) | If Cursor is installed (`~/.cursor/mcp.json` exists or Cursor app is present), `peek init` should offer to write that config too. Same for Windsurf and VS Code Copilot (`.vscode/mcp.json`). Walk at least one. **Expected:** the chosen client's mcp config now includes the `peek` server. | |
| B.6 | `peek sessions list` (empty state) | Before any browser recording: `peek sessions list`. **Expected:** "no sessions" or empty table — NOT an SQLite error. (The DB may not exist yet; the CLI should handle that.) | |
| B.7 | `peek audit log` (empty state) | `peek audit log` on a clean shell. **Expected:** "No audit log yet (~/.peek/audit.log)." — NOT a crash. | |

## Group C — Extension load

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| C.1 | Build | From the rrweb-stack repo root: `pnpm --filter @peekdev/extension build`. **Expected:** `packages/peek-extension/.output/chrome-mv3/` exists, contains `manifest.json`, `service-worker.js` (or equivalent), `rrweb-recorder.js`, the side-panel HTML, etc. | |
| C.2 | Load unpacked | `chrome://extensions` → toggle Developer mode → "Load unpacked" → select `packages/peek-extension/.output/chrome-mv3/`. **Expected:** extension appears in the list. Note the assigned extension ID (Chrome generates one). | |
| C.3 | Install card has the right shape (privacy-clean) | Look at the install dialog (or the extension's "Details" page). **Expected (per ADR-0008 / `PERMISSION_JUSTIFICATION.md`):** NO "Read and change all your data on all websites" warning. Likely shown: "Read your browsing history" (from `tabs`), "Access pages in your storage" (from `storage`), "side panel" (UI). NOT shown on install: anything about debugger. | |
| C.4 | `debugger` is OPTIONAL only | Extension Details → Permissions. **Expected:** `debugger` is listed under optional/runtime-requestable permissions, not granted by default. (Static guard: `e2e/smoke.spec.ts` already asserts this — but eyes-on confirms the install card matches.) | |
| C.5 | Pin icon, side panel opens | Pin the extension to the toolbar. Click it. **Expected:** Chrome's side panel opens with the peek UI. | |

## Group D — Per-site activation

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| D.1 | Initial idle | Side panel shows "no session yet" or similar. Visit `https://example.com`. **Expected:** still no recording. peek is per-site, not global. | |
| D.2 | Enable on this site | In the side panel: "Enable on this site". Chrome's permission grant for `https://example.com/*` appears. Approve. **Expected:** the side panel switches to recording state — header says "Recording: example.com" (or shows the URL/title), event counters appear. | |
| D.3 | Counters increment | Scroll the page. Click a link (stay on example.com — the page is mostly text but the activity should still register). Side panel event count rises. | |
| D.4 | Cross-origin not auto-recorded | Open a new tab, go to `https://wikipedia.org`. **Expected:** side panel for that tab shows no recording (per-origin opt-in, ADR-0008). To record this one too, click "Enable on this site" from the wikipedia.org tab — a SEPARATE permission grant. | |

## Group E — Recording pipeline → SQLite

After enabling example.com (D.2), do some clicks + open devtools to fire a few `console.log`s on the page, then:

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| E.1 | `peek status` shows non-zero | `peek status`. **Expected:** sessions count > 0 OR shows a non-empty DB. | |
| E.2 | `peek sessions list` shows the session | `peek sessions list`. **Expected:** at least one row, with the example.com URL and a recent timestamp. | |
| E.3 | `peek sessions show <id>` | `peek sessions show <the-id>`. **Expected:** session metadata (url, title, started_at, event count, console count, network count). | |
| E.4 | DB direct inspect | `sqlite3 ~/.peek/sessions.db 'SELECT id, url, started_at FROM sessions ORDER BY started_at DESC LIMIT 5;'`. Row exists. | |
| E.5 | events_chunks non-empty | `sqlite3 ~/.peek/sessions.db 'SELECT COUNT(*) FROM events_chunks;'`. Non-zero. | |
| E.6 | Chunk blobs on disk | `ls ~/.peek/rrweb-events/<sessionId>/`. **Expected:** one or more `<seq>.json.gz` files. (Path layout per Task 3.4 / 3.27.) | |
| E.7 | console_events table | `sqlite3 ~/.peek/sessions.db 'SELECT COUNT(*) FROM console_events;'`. Non-zero if you fired `console.log`s on example.com. | |

## Group F — Permission model (ADR-0010)

The five-level scale: 0 Off · 1 Read-only · 2 Suggestions · 3 Approved-act · 4 YOLO.

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| F.1 | Level 1 default | Side panel permission selector for example.com defaults to **Level 1**. (Read-only — recording happens, no AI write.) | |
| F.2 | Level 0 stops capture | Set example.com to Level 0. Reload the page, scroll, click. **Expected:** event counts stop rising in the side panel. `sqlite3 ~/.peek/sessions.db 'SELECT COUNT(*) FROM events_chunks WHERE session_id LIKE "%example.com%";'` count unchanged. | |
| F.3 | Level 1 resumes | Set back to Level 1. Reload, scroll, click. Counts rise again. | |
| F.4 | Level 4 + auto-expiry hint | Set to Level 4 (YOLO). **Expected:** side panel shows the auto-expiry badge ("expires in 60 min OR when tab closes" — exact wording in `peek-extension/src/sidepanel/`). | |
| F.5 | Level 4 → real AI write (deferred) | This requires the MAIN-world dispatcher (Phase 5). Mark ⏸ Phase-5-stub. | |

## Group G — Destructive blocklist

The destructive matcher fires before dispatch regardless of permission level — even at Level 4 it triggers a confirm flow. With the MAIN-world dispatcher stubbed in this build, full end-to-end is hard.

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| G.1 | Unit-test proof (the formal one) | From repo root: `pnpm --filter @peekdev/extension test src/__tests__/destructive.test.ts`. **Expected:** green. This is the canonical proof the matcher catches "Delete", "Drop", "Remove", "Cancel subscription", etc. Read the test file once — confirm the asserted patterns match what you'd want gated. | |
| G.2 | (Optional) End-to-end via SW console | Open `chrome://extensions` → peek → "Inspect views: service worker". In that console, dispatch a synthetic action: `chrome.runtime.sendMessage({type:'action.request', tabId:<active-tab-id>, action:{kind:'click', selector:'button.delete-account'}})`. **Expected:** the destructive matcher fires and the response is `{ok:false, requiresConfirm:true}` (or similar). With the MAIN-world dispatcher stubbed, this is the highest-fidelity check available. Mark ⏸ if the SW console doesn't expose the message API. | |

## Group H — Deep capture (chrome.debugger)

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| H.1 | Toggle Deep capture | In the side panel for example.com → "Deep capture" section → toggle ON. **Expected:** Chrome's `debugger` permission grant appears. Approve. | |
| H.2 | Mandatory yellow banner | After approving, the tab shows Chrome's "peek is debugging this browser" banner at the top. **This is non-suppressible by Chrome design** — confirm it's there (any extension using `chrome.debugger.attach` triggers it). | |
| H.3 | Body capture works | In that tab, visit `https://api.github.com/users/octocat`. **Expected:** the JSON response body is captured. Confirm: `sqlite3 ~/.peek/sessions.db 'SELECT method, url, status, length(response_body_redacted) FROM network_events WHERE response_body_redacted IS NOT NULL ORDER BY id DESC LIMIT 3;'`. Non-empty `response_body_redacted` for the github.com request. | |
| H.4 | Method is hardcoded GET (Phase-5 stub) | The captured row's `method` column will be `GET` regardless of the real method (per the runbook's deferred list). Note this as ⏸ Phase-5-stub; don't flag as a bug. | |
| H.5 | Body size cap + truncation marker | Visit `https://jsonplaceholder.typicode.com/photos` (~1 MB JSON). The captured body in DB should be ≤ 256 KB and end with the truncation marker `<<BODY_TRUNCATED@256KB>>`. Check: `sqlite3 ~/.peek/sessions.db "SELECT substr(response_body_redacted, length(response_body_redacted)-30) FROM network_events WHERE url LIKE '%photos%' ORDER BY id DESC LIMIT 1;"`. | |
| H.6 | Privacy revocation detaches ALL tabs of origin | Open 3 tabs of example.com (or any origin with Deep capture on). Toggle Deep capture OFF in the side panel. **Expected:** ALL 3 tabs lose the yellow banner simultaneously — not just the active one. (Task 3 carry-in #51 — this is a privacy-critical guarantee.) | |
| H.7 | Optional permission stays optional | After revoking Deep capture in the side panel, `chrome://extensions` → peek → Details → Permissions should show `debugger` removed from "granted" optional permissions. | |

## Group I — Privacy posture

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| I.1 | Zero remote network | While peek is actively recording, monitor outbound traffic. Either: install Little Snitch and watch for 60 sec, OR run `sudo tcpdump -i any -n 'tcp and not (host 127.0.0.1 or host ::1)'` for 60 sec while you browse. **Expected:** no peek-attributable traffic to any remote host. (The Chrome → peek-mcp loop is all local stdio; nothing should leave the box.) | |
| I.2 | Audit log file perms | After running an MCP write (e.g. asking Claude to `execute_action` in J.7 — or skip until J completes): `stat -f '%Sp' ~/.peek/audit.log` (macOS) or `stat -c '%A' ~/.peek/audit.log` (Linux). **Expected:** `-rw-------` (0o600). | |
| I.3 | Audit log redacts query-string VALUES | If there are `navigate` rows in the audit log, `cat ~/.peek/audit.log | grep navigate \| head -3`. **Expected:** URL keys remain (`?utm_source=...`) but values are masked (e.g. `?utm_source=<redacted>`). Note: this is only relevant once the dispatcher is wired enough to log navigates — may be sparse in this build. | |
| I.4 | `peek audit log --since 1h` filters | `peek audit log --since 1h`. **Expected:** only entries newer than 1 hour shown. If empty (nothing happened in the last hour), say "No matching audit entries." — NOT a crash. | |

## Group J — Claude Code MCP integration (the headline feature)

Prerequisite: J.0 — Claude Code is installed, authenticated, `peek init` (Group B.3) ran, AND you have at least one recorded session with some interaction + at least one console.log + at least one network call (Group E left you with that). Restart Claude Code so it picks up the new MCP entry.

| # | Item | Ask Claude → Expected | Status |
|---|---|---|---|
| J.0 | peek shows up in Claude Code's MCP tools | `/tools` (or whatever Claude Code's slash command for listing MCP servers is in the version you have). **Expected:** `peek` is listed; expanding it shows the 10 tools from A.2. | |
| J.1 | "What's in my latest peek session?" | Claude calls `list_recent_sessions`, then `get_session_summary` on the first. **Expected:** Claude's reply names example.com (or whatever you recorded), gives event/console/network counts that match `peek sessions show <id>`. | |
| J.2 | "Show me the console errors from my last session." | Claude calls `get_session_console_errors`. **Expected:** real console rows return (or "no errors" if you didn't trigger any — fine, but the tool call should happen). | |
| J.3 | "What network requests failed in my last session?" | Calls `get_session_network_errors`. **Expected:** real network rows. | |
| J.4 | "What did I click right before the first console error?" | Calls `get_user_action_before_error`. **Expected:** returns a click event with a DOM selector + timestamp. If your fixture never triggered a console error, do that first (open devtools on example.com and run `console.error('test')` while peek is recording). | |
| J.5 | "Generate a Playwright test that reproduces the steps leading to the first error." | Calls `generate_playwright_repro`. **Expected:** a `test('...', async ({ page }) => {...})` string, with `page.goto(...)` matching the URL and at least one `page.click(...)` matching a captured selector. | |
| J.6 | DOM snapshot tools | "Show me the DOM at the time of the error." Calls `get_dom_snapshot`. **Expected:** structured DOM tree, not raw HTML. | |
| J.7 | Write-class tool gating | "Click the Submit button on the page." Claude should call `request_authorization` first (Level-3 default). **Expected current behavior:** `request_authorization` returns a synthetic `panel-closed` (Phase-5-stub per runbook). `execute_action` returns `{ok:false, error:'MAIN-world dispatcher not wired (Phase 3e)'}`. Mark ⏸. **Important:** confirm Claude's UX surfaces the failure gracefully — it shouldn't get stuck retrying. | |
| J.8 | Run the generated Playwright repro (optional, headline-feature validation) | `pnpm dlx playwright install chromium` (one-time), then save J.5's output to `/tmp/repro.spec.ts` and `pnpm dlx playwright test /tmp/repro.spec.ts --reporter=line`. **Expected:** it actually runs and reproduces some of the steps. May or may not assert correctly — even a half-working repro is the headline-feature win. Note the fidelity. | |
| J.9 | MCP roots scoping | If Claude Code has a workspace open, ask "what sessions belong to this project?" peek's MCP server has `roots` negotiation per `peek-mcp/src/mcp/roots.ts`. **Expected:** filtered query, not all sessions. | |

## Group K — CLI exports / deletes

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| K.1 | Export to JSON | `peek sessions export <id> --format json --out /tmp/peek-export.json`. (Or the actual flag — `peek sessions export --help` to confirm.) **Expected:** file written, valid JSON, includes events. `jq . /tmp/peek-export.json \| head` parses cleanly. | |
| K.2 | Export to markdown / playwright | Repeat with `--format markdown` and `--format playwright`. **Expected:** non-empty outputs of the right shape. | |
| K.3 | Delete a session | `peek sessions delete <id>`. **Expected:** session no longer appears in `peek sessions list`. | |
| K.4 | Delete cascades to gzipped chunks | `ls ~/.peek/rrweb-events/<sessionId>/` — directory removed or empty. (If chunks linger, that's a 🟡 — leaked disk space.) | |
| K.5 | Delete is audit-logged | `peek audit log --tool sessions.delete` (or grep the file). **Expected:** an entry recording the deletion. | |

## Group L — Failure modes / graceful degradation

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| L.1 | Native-host crash + reconnect | `pkill -f peek-mcp` (or just `pkill peek-mcp`) while recording. The SW should attempt reconnect with backoff. Side panel should show "Disconnected" / "Reconnecting…" briefly. Interact with the page; next chrome.runtime.connectNative re-spawns the host. Recording resumes. **Expected:** no permanent failure; no data loss for events buffered after the kill. | |
| L.2 | Deep capture toggled mid-recording | While recording with Deep capture on, toggle Deep capture OFF. **Expected:** recording continues for rrweb + console (just no more bodies). No crash. The yellow banner disappears. | |
| L.3 | Browser restart | Close all Chrome windows, fully quit Chrome (Cmd+Q), reopen. **Expected:** opted-in origins are still opted-in; permission level is remembered; if you visit example.com, recording auto-starts (or starts on the first interaction). `chrome.storage.sync` survived. | |
| L.4 | Disk-full guard | (Optional — hard to simulate.) If `~/.peek` is on a filesystem that fills up mid-write, the SW should surface a "disk full" error and stop, not loop. Skip with ⏸ unless you have a way to simulate. | |

---

## Findings summary

Fill this in at the end.

| Bucket | Count | Items |
|---|---|---|
| ✅ Pass | | |
| 🔴 Showstopper | | |
| 🟡 Annoyance | | |
| 🟢 Polish | | |
| ⏸ Blocked / Phase-5-stub | | |

**Top showstoppers (must fix before public flip):**

1. _(none / list IDs)_

**Top annoyances (fix this week):**

1. _(none / list IDs)_

**Defer to Phase 5:**

1. _(list IDs)_

**Overall verdict:** ☐ Ship · ☐ Hold for fixes · ☐ Hold for design review

## Notes for the maintainer

A few things I flagged while drafting that you should expect to find as 🟡 (doc-vs-reality gaps), not 🔴:

1. **`peek install` doesn't exist** — the docs page says to run it; reality is `peek init` does the install. Fix: edit `apps/peek-docs/src/pages/getting-started.astro` to drop the separate "3. Install the native messaging host" section and fold it into "configure your AI client". (Listed in B/A.4 above.)
2. **`peek-mcp --version` and `peek-mcp --install-native-host` are not implemented** — by design (the install needs consent). Don't surface as findings unless we want to add them.
3. **MAIN-world dispatcher is the headline gap** — J.7, J.8, F.5, G.2 are all blocked on Phase 5. The QA confirms the *read* surface is solid; the *write* surface is intentionally stubbed.
