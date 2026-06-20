# peek — Privacy Policy

**Last updated: 2026-06-09**

peek is a local-first developer tool. The Chrome extension captures your real
browser session and ships it through a **native-messaging stdio bridge** to a
**local** MCP server (`peek-mcp`). **Nothing leaves your machine.** No remote
endpoints, no telemetry, no analytics, no third-party SDKs.

This document is the canonical privacy policy used for the Chrome Web Store
listing.

## What peek processes

When you enable peek on a site, the extension records:

- **DOM + interaction events** — a masked rrweb session (DOM snapshots, mouse
  movement, scroll, input events). PII heuristics mask form values and inputs
  with `password` / `email` / autocomplete tokens before forwarding.
- **Console events** — `console.log`/`info`/`warn`/`error`/`debug` arguments,
  with the same masking applied.
- **Network metadata** — request URL (path masked), method, status, timing,
  initiator. Captured by a page-side rrweb network plugin
  (`rrweb/network@1`) that emits requests through the rrweb event stream;
  the events are masked in the ISOLATED-world relay before leaving the page.
  Bodies are **not** captured at this level.
- **Network bodies (opt-in "Deep capture" only)** — when you toggle Deep
  capture for a specific origin, the extension attaches `chrome.debugger`
  to that tab and records response bodies via the CDP `Network` domain.
  Bodies are masked and capped at 256 KB with a truncation marker.
- **Shadow-DOM reports** — counts of closed shadow roots peek could not
  recurse into (for diagnostic purposes only — no contents).

peek **does not** record:

- Sites you have not explicitly enabled. There is no `<all_urls>` host
  permission. Per-origin opt-in is enforced before any recorder injection.
- Background tabs you are not actively recording.
- Any traffic outside the tab origins you opt in to.

## Where the data goes

1. **Browser extension** — masks events in the page (ISOLATED-world content
   script) before passing them to the service worker.
2. **Service worker** — forwards events to the local native host via
   `chrome.runtime.connectNative('com.cubenest.peek')`. This is a stdio pipe;
   no sockets, no localhost HTTP server, no DNS lookups.
3. **`peek-mcp` native host** — persists events to a local SQLite database
   at `~/.peek/sessions.db` (POSIX) or `%APPDATA%\peek\sessions.db`
   (Windows). Large event chunks are gzipped to `~/.peek/rrweb-events/`.
4. **AI coding agents** — when you point Claude Code / Cursor / Cline /
   Windsurf at the `peek-mcp` MCP server, the agent reads sessions from the
   local SQLite database. Reads are gated by the permission model below.

There is **no cloud sync, no telemetry endpoint, and no third-party data
sharing.** The packages are Apache 2.0 — you can verify the network surface
by inspecting the source.

## Permission model

Per-origin, 5 levels. Default is **Level 1 — Observe only**. Higher levels are
opt-in per origin.

| Level | Name | What peek can do |
|---|---|---|
| 0 | Off | Recording suppressed, tool surface disabled for the origin. |
| 1 | Observe | Read recorded sessions, and take an on-demand **live page snapshot** (`get_page_view`) — a masked, ref-tagged list of interactive elements, non-mutating. **Default.** |
| 2 | Suggest | Read + propose actions (no execution). |
| 3 | Confirm | Read + execute one-shot actions with per-action user confirmation in the side panel. |
| 4 | YOLO | Read + execute without per-action prompts (60-min, tab-scoped). Destructive-action terms still prompt. |

**Live page snapshot (`get_page_view`)** — at Level 1+, an agent may request an
on-demand snapshot of the current page: a compact, ref-tagged list of interactive
elements (so it can act on a stable reference instead of guessing a CSS selector).
It is non-mutating and audit-logged. Password/email/tel and PII-autofill values
(card, address, birthday, name, etc.), and any field marked `.rr-mask` /
`data-private` / `data-dd-privacy` / `data-peek-mask`, are dropped in-page;
structured PII in the remaining text is masked before it leaves the device. As with
the recorder, free-text field values may be included — mark sensitive free-text
fields with a mask class to exclude them.

**Destructive-action blocklist override** — even at Level 4 YOLO, actions
whose target matches "delete", "remove", "drop", "uninstall", "transfer",
"send", "pay", etc. (full list in `permissions/destructive.ts`) require
explicit confirmation. This mirrors Anthropic Claude for Chrome's "Claude
still asks for high-risk actions" posture.

**Deep capture** — separately gated. Requires per-origin opt-in via the
"Deep capture" toggle; only then does the extension attach `chrome.debugger`
to that origin's tabs. `debugger` is a static manifest permission (declared in
the extension's `permissions`), but it is never exercised until you enable Deep
capture for an origin. Disabling Deep capture for an origin detaches the
debugger from **every** tab on that origin immediately (not lazily).

## User controls

- **Per-site Enable / Disable** — in the side panel. Disable detaches the
  recorder from all tabs of that origin.
- **Recording indicator** — an always-on toolbar badge plus a default-on
  in-page glow (inside a closed shadow root, excluded from peek's own
  capture) shows when recording is active. The "Show recording border"
  toggle in the side panel hides the glow; the badge remains visible.
- **Deep capture toggle** — separate, per-origin. Off by default.
- **Permission level** — set per origin in the side panel. Default Level 1.
- **Delete a session** — via the `peek delete <session-id>` CLI or by
  removing rows from `~/.peek/sessions.db` directly.
- **Delete all data** — `rm -rf ~/.peek/` (POSIX) or remove
  `%APPDATA%\peek\` (Windows).
- **Audit log** — every action dispatched through `peek-mcp`'s
  `execute_action` MCP tool is recorded to `~/.peek/audit.log` (mode 0600).
  The log captures decision, level, target, and the requesting MCP client.
- **Pause** — set permission level to 0 (Off) on an origin to suppress
  recording without losing the per-origin opt-in.

## Open source

peek is Apache 2.0. Repository: https://github.com/Cubenest/rrweb-stack
(public). The privacy posture above can be verified by reading the source —
particularly:

- `packages/peek-extension/entrypoints/background.ts` — service worker,
  message router, native port.
- `packages/peek-extension/src/relay/mask.ts` — masking applied before
  forward.
- `packages/peek-mcp/src/native-host/` — stdin/stdout handler and SQLite
  writers.

No build phase, no installer, and no runtime path makes network calls to
any host outside `chrome.runtime.connectNative('com.cubenest.peek')`.

## Contact

For questions, open an issue on the [repository](https://github.com/Cubenest/rrweb-stack/issues).

To report a privacy or security vulnerability, please use [GitHub's private vulnerability reporting](https://github.com/Cubenest/rrweb-stack/security/advisories/new) per the [`SECURITY.md`](https://github.com/Cubenest/rrweb-stack/blob/main/SECURITY.md) policy — coordinated disclosure with a 3-business-day acknowledgement target.

## Changes

Material changes to this policy will bump the date at the top and be noted
in the repository's `CHANGELOG`.
