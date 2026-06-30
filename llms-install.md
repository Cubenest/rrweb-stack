# Installing peek — instructions for an AI coding agent

You are setting up **peek** for the user: a local-first browser-session forensics
MCP server. Follow these steps in order. Local-first: peek uploads nothing —
what your MCP client does with the data is up to you.

## What peek is

peek's MCP server (`@peekdev/mcp`) lets you read the user's locally-recorded
browser sessions — DOM history, console & network errors, and the exact user
action right before an error — and turn them into a runnable Playwright repro.
Sessions are captured by a companion Chrome extension and stored in
`~/.peek/sessions.db`. One npm binary plays two roles: the stdio MCP server you
talk to, and the native messaging host the Chrome extension writes through.

## Prerequisite — check before you start

- **Node.js ≥ 22.** Run `node -v`. If it is below 22, stop and tell the user to
  upgrade: peek's `better-sqlite3` dependency only ships prebuilt binaries for
  Node 22+ and will fail to compile from source on older Node (notably Windows).

## Step 1 — Register the peek MCP server with this client

**This is a config-file edit, not a shell command** — write the JSON below into
the MCP config file of the client you are running inside (e.g. Cline's
`cline_mcp_settings.json`, Cursor's `~/.cursor/mcp.json`, Claude Code's
`~/.claude.json`). Do not try to "run" this step in a terminal.

The `@latest` tag is **required** — peek is in alpha, every published version is
a prerelease, and a bare `@peekdev/mcp` resolves the implicit `*` range and fails
with `ETARGET: No matching version found`:

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

After writing the config, reload/restart the client so it spawns the server.

## Step 2 — Verify the server is wired (after the client reloads)

peek's tools only become available **after the client reloads** the config from
Step 1 — you usually will **not** see them in the same turn you wrote the config.
If peek's tools aren't visible yet, that's expected, not a failure: ask the user
to reload/restart the client, then continue. `list_recent_sessions` is an **MCP
tool, not a CLI** — never try to run it as a shell command.

Once peek's tools are available, call `list_recent_sessions`. The server is
correctly registered if it returns anything at all — a JSON list of sessions, or
a short text message such as *"No sessions recorded yet"*. Before Step 3 there is
no `~/.peek/sessions.db`, so that "no sessions recorded yet" message is the
**expected** response and means the server is wired — it is not a failure.
Continue to Step 3 to start capturing.

## Step 3 — Enable capture (one terminal command + one manual browser step)

The server above can answer queries, but it has nothing to read until peek is
capturing sessions. Two more pieces are needed:

1. **Register the native messaging host.** Run these as **two separate commands**
   — do not join them with `&&` (Windows PowerShell does not support `&&`
   chaining):

   ```bash
   npm install -g @peekdev/cli
   ```

   ```bash
   peek init
   ```

   `peek init` is a short **interactive** wizard — if you are running unattended,
   ask the user to run it. It auto-detects your installed MCP
   clients and offers to write peek's config to each (Claude Code, Cursor, and
   Windsurf directly; a manual block for Cline and Codex CLI) — you can skip that
   since Step 1 already handled this client — and, crucially, it registers peek's
   native-host manifest into Chrome's `NativeMessagingHosts/` directory so the
   extension can reach the local store.

2. **Install the Chrome extension — you cannot do this for the user.** Ask them
   to install it from the Chrome Web Store (a browser action only they can take):

   > Install the **peek** extension:
   > https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb

   Once it's installed and they browse, `list_recent_sessions` will start
   returning real captures.

## Good to know

- peek is **local-only**: stdio transport over a child-process pipe — no HTTP,
  no SSE, no remote endpoint, no auth, no telemetry.
- Read tools are unauthenticated. Write tools (`execute_action`) are **off by
  default**, behind a per-origin permission model and a destructive-action
  blocklist.
- `PEEK_HOME` defaults to `~/.peek`; set it via an `env` entry only if the user
  wants a non-default capture directory.
- Full docs: https://peek.cubenest.in
