<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-peek.svg" height="40" alt="peek">

# @peekdev/cli

> Your real browser, exposed to your AI coding agent over MCP — capture once, query forever, never leaves your machine.

[![npm](https://img.shields.io/npm/v/@peekdev/cli.svg)](https://www.npmjs.com/package/@peekdev/cli)
[![downloads](https://img.shields.io/npm/dw/@peekdev/cli.svg)](https://www.npmjs.com/package/@peekdev/cli)
[![license](https://img.shields.io/npm/l/@peekdev/cli.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![node](https://img.shields.io/node/v/@peekdev/cli.svg)](https://www.npmjs.com/package/@peekdev/cli)
![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

![peek sessions list and drill-down — three real sessions, console + network errors, markdown-formatted output for AI paste](https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/peek-hero.gif)

Docs: <https://peek.cubenest.in>

> **Requires Node.js ≥ 22.** peek's native `better-sqlite3` dependency only ships
> prebuilt binaries for Node 22+ — on Node 20 (notably Windows, which has no
> C/C++ toolchain by default) the install falls back to compiling from source and
> fails. Use Node 22 or newer.

```sh
npm install -g @peekdev/cli
peek init
```

`peek init` is an interactive wizard. It:

1. Installs the native messaging host for the **Peek** Chrome extension (writes `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.cubenest.peek.json` on macOS, equivalent on Linux + Windows).
2. Detects your AI coding-agent client (Claude Code, Cursor, Cline, Windsurf, VS Code) and adds the `peek-mcp` server to its MCP configuration.
3. Prints a one-line "install the extension" link.

Then you install the **Peek Chrome extension** — available on the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb) (contributors and local builds can instead load it unpacked from `packages/peek-extension/chrome-mv3/`, see [`@peekdev/extension`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-extension)) — open the side panel on the site you want to capture, and click **Enable on this site**. Your AI agent can now query the recording.

## What this is NOT

- Not a session-replay product for production traffic. Peek is a **developer-side** tool — captures happen on your machine, in your browser, when you explicitly enable them per site.
- Not Sentry, LogRocket, or FullStory. There is no cloud, no upload, no telemetry, no signup. Captures live in `~/.peek/sessions.db` until you delete them.
- Not a screen recorder. Peek captures structured DOM/console/network via rrweb, not pixels. AI agents query JSON, not video frames.

## Commands

```sh
peek init                                  # interactive install (see above)
peek status                                # health check — extension connected? DB writable?
peek sessions list [--origin <url>] [--limit <n>] [--json]  # list recent sessions
peek sessions show <id>                    # print one session as Markdown (metadata + errors)
peek sessions export <id> [--format <markdown|json|playwright>] [--out <file>]  # export (default markdown)
peek sessions delete <id>                  # delete one session
peek sessions delete --all-older-than <dur>  # delete every session older than e.g. 7d
peek audit log [--since <dur>] [--tool <name>] [--client <name>] [--json]  # act-tool audit log
peek audit verify [--json]                 # verify the audit log hash chain (exit 0 ok, 1 anomaly, 2 tampered)
peek <cmd> --help                          # usage for any subcommand
```

`--format html` is reserved but not yet implemented (it exits non-zero with a message — use `markdown` or `json`). All commands read `~/.peek/sessions.db` except `sessions delete` (and `peek init`, which writes the install config). Nothing leaves your machine.

### Audit log integrity

The audit log (`~/.peek/audit.log`) is hash-chained: each JSONL entry carries a `seq` counter and a `prevHash` field (SHA-256 of the previous line), written under a file lock. A small sidecar (`audit.head.json`) records the tail hash so that tail truncation is also detectable.

`peek audit verify [--json]` recomputes the chain and reports:

| Status | Meaning | Exit code |
|---|---|:---:|
| `intact` | chain is complete and unbroken | 0 |
| `head-missing` | chain is internally consistent but the sidecar is absent (tail truncation cannot be ruled out) | 0 |
| `no-log` | no audit log exists yet | 0 |
| `incomplete-final` | last line is an incomplete write (likely a crash mid-write) | 1 |
| `gaps` | intentional gaps from lock-contention fallback entries | 1 |
| `broken` | `prevHash` mismatch — a line was edited or reordered | 2 |
| `truncated` | log ends before the recorded head (lines were removed from the tail) | 2 |
| `prefix-tampered` | pre-chain prelude was modified | 2 |

The audit log is **tamper-evident, not tamper-proof.** It detects accidental corruption, truncation, reordering, and edits, but does not stop a determined local attacker who recomputes the whole chain. There are no keys, no external anchor, and no egress.

## Querying from an AI agent

After `peek init`, the `peek-mcp` server is available to your AI client as an MCP toolset. Sample queries:

- "what's in my latest peek session?"
- "show me the console errors from session `abc123` between t=10s and t=15s"
- "find network requests with status >= 400 from the last 5 minutes of recording on `example.com`"
- "generate a Playwright reproduction script from session `abc123`"

The MCP server exposes 16 tools — listing, session summaries, console/network drill-down, user-action history, DOM reconstruction and history, Playwright-repro generation, a live ref-tagged page view, non-destructive element highlighting, and (with explicit per-origin permission) actions like clicks/inputs/navigation plus a pause-and-hand-back-to-the-user input handoff. See [`@peekdev/mcp`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-mcp) for the tool reference.

## Privacy

Peek is **local-first**. The CLI reads from `~/.peek/sessions.db` (SQLite); the extension records into it; the MCP server queries it. There is no network destination. There is no telemetry. There is no auto-update channel. The native host runs as your user, not as a daemon.

The extension uses per-origin host permissions — recording is **off** for every site by default. You enable it explicitly from the side panel for each origin you care about. The five-level permission model (0 Off → 1 Read-only → 2 Suggest-only → 3 Act-with-confirm → 4 YOLO), plus a cross-level destructive-action blocklist that always prompts, is enforced server-side, not just in the UI.

Full data-handling policy: [`docs/peek/PRIVACY_POLICY.md`](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/PRIVACY_POLICY.md). Chrome Web Store permission justifications: [`docs/peek/PERMISSION_JUSTIFICATION.md`](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/PERMISSION_JUSTIFICATION.md).

## Supported AI clients

`peek init` configures the MCP server into:

| Client | Detection |
|---|---|
| Claude Code (CLI) | `~/.claude.json` |
| Cursor | `~/.cursor/mcp.json` |
| VS Code | `.vscode/mcp.json` (project-scoped) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline (VS Code) | manual config (lives in VS Code's per-OS globalStorage) |

> **Windows path note.** The `~` in these paths is your home directory (e.g. `C:\Users\<username>`). The CLI resolves it automatically via Node's `os.homedir()` + `path.join`, so the same config locations work on Windows, macOS, and Linux.

If your client isn't auto-detected (for example Continue or Zed, which `peek init` does not detect), paste the manual MCP JSON config shown below into that client's MCP settings. `peek init` also prints this block when it can't find a known client. The MCP server speaks the standard stdio protocol (spec 2025-11-25 + 2025-03-26 back-compat).

```json
{
  "mcpServers": {
    "peek": {
      "command": "npx",
      "args": ["-y", "@peekdev/mcp@latest"]
    }
  }
}
```

### Claude Code skill

When Claude Code is among the configured clients (or `~/.claude.json` already exists), `peek init` also drops a SKILL.md into `~/.claude/skills/peek/`. Claude Code loads it on session start and uses it to decide *when* to reach for peek's MCP tools — investigating an error from a manual repro, generating a Playwright test from a session, querying DOM state at a past moment, etc.

The skill is idempotent on re-run (no-op when the on-disk content matches the bundled source). Skip the install with `peek init --skip-skill`. Want it without running `peek init`? See the curl-able recipe at [`docs/peek/distribution/claude-code-skill.md`](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/distribution/claude-code-skill.md).

### Cursor — project-level recipe

`peek init` writes Cursor's MCP server entry to the global config at `~/.cursor/mcp.json` — every project opened in Cursor inherits it. If you'd rather scope peek to one project (a repo where peek captures matter but other repos on the same machine should not surface the tools), drop a `.cursor/mcp.json` into the workspace root:

```json
{
  "mcpServers": {
    "peek": {
      "command": "npx",
      "args": ["-y", "@peekdev/mcp@latest"]
    }
  }
}
```

Commit it or add it to `.gitignore` — Cursor reads either. Cursor's docs document the global file as "tools available everywhere" and the project file as "project-specific tools" (see [cursor.com/docs/context/mcp](https://cursor.com/docs/context/mcp) for current merge semantics).

This is the same block `peek init` writes to the global file, so the two configs are interchangeable. You still need the **Peek Chrome extension** installed — from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb), or loaded unpacked from `packages/peek-extension/chrome-mv3/` for local builds (see [`@peekdev/extension`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-extension)) — and the native messaging host registered — run `peek init --skip-clients` if you want the host installed without touching any MCP config.

## Versioning & compatibility

Semantic Versioning. Currently `0.1.0-alpha.x` — pre-release; the CLI surface is stable in spirit but flags may rename. See [SUPPORTED.md](https://github.com/Cubenest/rrweb-stack/blob/main/SUPPORTED.md) for the compatibility matrix.

`@peekdev/cli` depends on `@peekdev/mcp` as a workspace peer. Both are versioned and published together via Changesets + OIDC Trusted Publishing.

Full release history: [CHANGELOG.md](https://github.com/Cubenest/rrweb-stack/blob/main/packages/peek-cli/CHANGELOG.md).

## License

Apache 2.0. The bundled rrweb engine remains MIT-licensed; see [`NOTICE`](https://github.com/Cubenest/rrweb-stack/blob/main/packages/peek-cli/NOTICE).

Contributions are accepted under the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) — sign your commits with `git commit -s`. See [CONTRIBUTING.md](https://github.com/Cubenest/rrweb-stack/blob/main/CONTRIBUTING.md) + [SECURITY.md](https://github.com/Cubenest/rrweb-stack/blob/main/SECURITY.md).
