# @peekdev/cli

> Your real browser, exposed to your AI coding agent over MCP — capture once, query forever, never leaves your machine.

[![npm](https://img.shields.io/npm/v/@peekdev/cli.svg)](https://www.npmjs.com/package/@peekdev/cli)
[![downloads](https://img.shields.io/npm/dw/@peekdev/cli.svg)](https://www.npmjs.com/package/@peekdev/cli)
[![license](https://img.shields.io/npm/l/@peekdev/cli.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)

![peek sessions list and drill-down — three real sessions, console + network errors, markdown-formatted output for AI paste](https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/peek-hero.gif)

```sh
npm install -g @peekdev/cli
peek init
```

`peek init` is an interactive wizard. It:

1. Installs the native messaging host for the **Peek** Chrome extension (writes `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.peekdev.peek.json` on macOS, equivalent on Linux + Windows).
2. Detects your AI coding-agent client (Claude Code, Cursor, Cline, Windsurf, Continue, Zed) and adds the `peek-mcp` server to its MCP configuration.
3. Prints a one-line "install the extension" link.

Then you install the [Peek Chrome extension](https://chromewebstore.google.com/) (CWS submission pending), open the side panel on the site you want to capture, and click **Enable on this site**. Your AI agent can now query the recording.

## What this is NOT

- Not a session-replay product for production traffic. Peek is a **developer-side** tool — captures happen on your machine, in your browser, when you explicitly enable them per site.
- Not Sentry, LogRocket, or FullStory. There is no cloud, no upload, no telemetry, no signup. Captures live in `~/.peek/sessions.db` until you delete them.
- Not a screen recorder. Peek captures structured DOM/console/network via rrweb, not pixels. AI agents query JSON, not video frames.

## Commands

```sh
peek init                          # interactive install (see above)
peek status                        # health check — extension connected? DB writable?
peek sessions list [--json]        # list recent recording sessions
peek sessions show <id>            # show one session's metadata + counts
peek sessions export <id> --format <html|json|playwright>  # export for sharing
peek sessions delete <id>          # delete one session + its on-disk events
peek audit [--json]                # show the destructive-action audit log
peek <cmd> --help                  # usage for any subcommand
```

All commands operate read-only on `~/.peek/sessions.db` except `sessions delete` (and `peek init` which writes the install config). Nothing leaves your machine.

## Querying from an AI agent

After `peek init`, the `peek-mcp` server is available to your AI client as an MCP toolset. Sample queries:

- "what's in my latest peek session?"
- "show me the console errors from session `abc123` between t=10s and t=15s"
- "find network requests with status >= 400 from the last 5 minutes of recording on `example.com`"
- "generate a Playwright reproduction script from session `abc123`"

The MCP server exposes ~20 tools — listing, querying, exporting, DOM reconstruction, console/network drill-down, and (with explicit per-action authorization) destructive actions like clicks/inputs/navigation. See [`@peekdev/mcp`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-mcp) for the tool reference.

## Privacy

Peek is **local-first**. The CLI reads from `~/.peek/sessions.db` (SQLite); the extension records into it; the MCP server queries it. There is no network destination. There is no telemetry. There is no auto-update channel. The native host runs as your user, not as a daemon.

The extension uses per-origin host permissions — recording is **off** for every site by default. You enable it explicitly from the side panel for each origin you care about. The five-level permission model (read-only → read-with-confirmation → constrained-write → broad-write → destructive) is enforced server-side, not just in the UI.

Full data-handling policy: [`docs/peek/PRIVACY_POLICY.md`](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/PRIVACY_POLICY.md). Chrome Web Store permission justifications: [`docs/peek/PERMISSION_JUSTIFICATION.md`](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/PERMISSION_JUSTIFICATION.md).

## Supported AI clients

`peek init` configures the MCP server into:

| Client | Detection |
|---|---|
| Claude Code (CLI) | `~/.claude/` |
| Cursor | `~/Library/Application Support/Cursor/User/` (macOS) |
| Cline (VS Code) | VS Code workspace settings |
| Continue (VS Code) | `~/.continue/` |
| Windsurf | `~/.codeium/windsurf/` |
| Zed | `~/.config/zed/` |

If your client isn't auto-detected, `peek init` prints the JSON config you can paste manually. The MCP server speaks the standard stdio protocol (spec 2025-11-25 + 2025-03-26 back-compat).

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
      "args": ["-y", "@peekdev/mcp"]
    }
  }
}
```

Commit it or add it to `.gitignore` — Cursor reads either. Cursor's docs document the global file as "tools available everywhere" and the project file as "project-specific tools" (see [docs.cursor.com/context/mcp](https://cursor.com/docs/context/mcp) for current merge semantics).

This is the same block `peek init` writes to the global file, so the two configs are interchangeable. You still need the [Peek Chrome extension](https://chromewebstore.google.com/) installed and the native messaging host registered — run `peek init --skip-clients` if you want the host installed without touching any MCP config.

## Versioning & compatibility

Semantic Versioning. Currently `0.1.0-alpha.x` — pre-release; the CLI surface is stable in spirit but flags may rename. See [SUPPORTED.md](https://github.com/Cubenest/rrweb-stack/blob/main/SUPPORTED.md) for the compatibility matrix.

`@peekdev/cli` depends on `@peekdev/mcp` as a workspace peer. Both are versioned and published together via Changesets + OIDC Trusted Publishing.

## License

Apache 2.0. The bundled rrweb engine remains MIT-licensed; see `NOTICE`.

Contributions are accepted under the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) — sign your commits with `git commit -s`. See [CONTRIBUTING.md](https://github.com/Cubenest/rrweb-stack/blob/main/CONTRIBUTING.md) + [SECURITY.md](https://github.com/Cubenest/rrweb-stack/blob/main/SECURITY.md).
