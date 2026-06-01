<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-peek.svg" height="40" alt="peek">

# @peekdev/mcp

> Your real browser, exposed to your AI coding agent over MCP — capture once, query forever, never leaves your machine.

[![npm](https://img.shields.io/npm/v/@peekdev/mcp.svg)](https://www.npmjs.com/package/@peekdev/mcp)
[![downloads](https://img.shields.io/npm/dw/@peekdev/mcp.svg)](https://www.npmjs.com/package/@peekdev/mcp)
[![license](https://img.shields.io/npm/l/@peekdev/mcp.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)

Docs: <https://peek.cubenest.in>

`@peekdev/mcp` is **two things in one binary**:

1. The **stdio MCP server** that AI coding agents (Claude Code, Cursor, Cline, Windsurf, Continue, Zed) speak to when querying your captured browser sessions.
2. The **native messaging host** that Chrome's MV3 extension speaks to when writing into `~/.peek/sessions.db`.

The same binary handles both roles — chosen by argv. You don't install this package directly in normal use; the [`@peekdev/cli`](https://www.npmjs.com/package/@peekdev/cli) `peek init` wizard wires it into your AI client's MCP config and into Chrome's `NativeMessagingHosts/`.

## You probably want `@peekdev/cli` instead

```sh
npm install -g @peekdev/cli
peek init
```

Read on if you're configuring the MCP server manually, building tooling against it, or want the protocol/tool reference.

## What this is NOT

- Not a remote MCP server. Peek is **local-only**: stdio transport over a child-process pipe. There is no HTTP listener, no SSE endpoint, no remote auth. The MCP transport spec's Streamable HTTP variant is out of scope by design.
- Not a write-by-default tool. Read tools are unauthenticated; write tools (clicks, inputs, navigation, destructive actions) require explicit per-action authorization, recorded in `~/.peek/audit.log`.
- Not a wrapper around Chrome DevTools Protocol. The server reads recorded events from SQLite; the extension owns capture. No live `chrome.debugger` access from the MCP server.

## Manual MCP-client config

If `peek init` doesn't recognize your client, paste this into your client's MCP server registry:

```json
{
  "mcpServers": {
    "peek": {
      "command": "npx",
      "args": ["-y", "@peekdev/mcp"],
      "env": {
        "PEEK_HOME": "~/.peek"
      }
    }
  }
}
```

For Claude Code, this goes in `~/.claude/mcp_servers.json` (per-project) or via `claude mcp add`. For Cursor: `~/Library/Application Support/Cursor/User/mcp_servers.json` (macOS). For Continue: in your `~/.continue/config.json` under `experimental.modelContextProtocolServers`.

## What the AI agent can do

| Tool | Action | Authorization |
|---|---|---|
| `list_recent_sessions` | List recently recorded sessions, newest first (id, origin, ts, event count) | none |
| `get_session_summary` | LLM-readable narrative summary of a session | none |
| `get_session_console_errors` | List console errors recorded in a session | none |
| `get_session_network_errors` | List failed/notable network requests in a session | none |
| `get_user_action_before_error` | Last N user actions before a console error | none |
| `generate_playwright_repro` | Generate a runnable Playwright test from a session | none |
| `get_dom_snapshot` | Reconstruct the DOM at a given timestamp | none |
| `query_dom_history` | Timeline of attribute/text changes for a selector | none |
| `request_authorization` | Side-panel consent for write actions (Level 3) | per-action user prompt |
| `execute_action` | Dispatch a UI action (gated by permission level + destructive blocklist) | permission level + destructive blocklist |

The full tool list is exposed via the MCP `tools/list` request (spec 2025-11-25 + back-compat for 2025-03-26). Tool docs ship with the binary via `tools/list` response `description` fields.

## Permission model (the five levels)

Per-origin, 5 levels (0–4). Default is **Level 1 — Read-only**. Higher levels are opt-in per origin.

| Level | Name | What it allows | Default |
|---|---|---|---|
| 0 | Off | Recording suppressed, tool surface disabled for the origin | |
| 1 | Read-only | Read recorded sessions; no action execution | enabled |
| 2 | Suggest-only | Read + highlight DOM via overlay; no DOM mutation | |
| 3 | Act-with-confirm | Read + execute actions, each prompting Allow once / Always for this site / Deny | |
| 4 | YOLO this session | Read + execute non-destructive actions with no prompt (auto-expires on tab close or 60 min) | |

At **Level 3** every `execute_action` call prompts the user via the side-panel banner (unless a one-shot `confirmToken` from a prior `request_authorization` is passed). At **Level 4 (YOLO)** non-destructive actions are auto-allowed with no prompt. Levels 0–2 deny `execute_action`.

**Destructive-action blocklist (cross-level override)** — independent of the level, any action whose resolved target text/label matches a destructive term (`delete`, `remove`, `transfer`, `send`, `pay`, `withdraw`, etc. — full base list in `permissions/destructive.ts`, extensible via `~/.peek/policy.json`) **always** prompts for confirmation. This overrides all levels, including Level 4 YOLO — it is not a separate "Level 5".

Every `execute_action` and `request_authorization` call is appended to `~/.peek/audit.log` (JSONL, mode 0600 — `peek audit log --json` prints it), including denied ones.

## Database

`~/.peek/sessions.db` — SQLite (better-sqlite3, WAL mode). Schema in `src/db/migrations/`. The CLI opens this DB read-mostly; the native host writes it during extension capture; the MCP server reads it for tool calls.

The native host is the **only writer**. The CLI and MCP server only read (except for the audit log, which is append-only JSONL on disk, not in the DB).

## Subpath exports

For consumers building tooling on top of peek:

```ts
import { generatePlaywrightRepro } from '@peekdev/mcp/mcp/playwright-repro';
import { loadSessionEvents } from '@peekdev/mcp/mcp/event-blobs';
import { openDb } from '@peekdev/mcp/db';
import { startNativeHost } from '@peekdev/mcp/native-host';
```

These are the subpath exports the `@peekdev/cli` package uses. API surface is small but stable.

## Versioning & compatibility

Semantic Versioning. Currently `0.1.0-alpha.x` — pre-release; tool schemas are stable in spirit but new tools may land in patch releases. See [SUPPORTED.md](https://github.com/Cubenest/rrweb-stack/blob/main/SUPPORTED.md) for the compatibility matrix (MCP protocol versions, Chrome stable channels, Node versions).

## Privacy

Local-only. No network destinations. No telemetry. The MCP transport is stdio over a child-process pipe — your AI client launches `peek-mcp`, talks to it over stdin/stdout, and kills it when done. The binary holds no persistent state outside `~/.peek/`.

Full data-handling policy: [`docs/peek/PRIVACY_POLICY.md`](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/PRIVACY_POLICY.md). Threat model: [`docs/peek/THREATMODEL.md`](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/THREATMODEL.md).

## Distribution (maintainer-facing)

> This section is for the maintainer's submission workflow at Phase 5 launch.
> If you're a user, you don't need any of this — just `npx @peekdev/cli init`.

peek is listed (or queued for listing) on the discovery surfaces below.
Each linked file is a **submission scaffold** with pre-filled metadata
audited against the registry's current schema as of 2026-05-30 — not a
user-facing install guide.

- [Official MCP Registry submission](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/distribution/modelcontextprotocol-servers.md) — `server.json` for `registry.modelcontextprotocol.io` via `mcp-publisher` CLI. Downstream registries (PulseMCP, others) ingest from here.
- [PulseMCP submission](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/distribution/pulsemcp.json) — URL-only form + auto-ingest from the MCP Registry.
- [Smithery submission](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/distribution/smithery.json) — MCPB bundle uploaded via `smithery mcp publish`.
- [mcp.so submission](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/distribution/mcp-so.md) — web-form submission with the source content paste-ready.
- [Claude Code skill standalone install](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/distribution/claude-code-skill.md) — curl recipe for users who want the Claude Code skill without running `peek init`.

Launch order is documented in [`docs/peek/distribution/README.md`](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/distribution/README.md) (CWS first, then the MCP-registry fan-out).

## License

Apache 2.0. The bundled rrweb engine remains MIT-licensed; see `NOTICE`.

Contributions are accepted under the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) — sign your commits with `git commit -s`. See [CONTRIBUTING.md](https://github.com/Cubenest/rrweb-stack/blob/main/CONTRIBUTING.md) + [SECURITY.md](https://github.com/Cubenest/rrweb-stack/blob/main/SECURITY.md).
