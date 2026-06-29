# Installing peek — instructions for an AI coding agent

You are setting up **peek** for the user: a local-first browser-session forensics
MCP server. Follow these steps in order. Everything runs locally — peek uploads
nothing.

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

Add this server to the MCP configuration of the client you are running inside.
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

## Step 2 — Verify the server is wired

Call peek's `list_recent_sessions` tool. The server is correctly registered if the
tool is **callable and returns anything at all** — either a JSON list of sessions,
or a short text message such as *"No sessions recorded yet"*. Before Step 3 there
is no `~/.peek/sessions.db`, so the "no sessions recorded yet" message is the
**expected** response and means the server is wired — it is **not** a failure.
Do not retry or report an error; continue to Step 3 to start capturing.

## Step 3 — Enable capture (one terminal command + one manual browser step)

The server above can answer queries, but it has nothing to read until peek is
capturing sessions. Two more pieces are needed:

1. **Register the native messaging host.** Run:

   ```bash
   npm install -g @peekdev/cli && peek init
   ```

   `peek init` is a short interactive wizard. It auto-detects your installed MCP
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
