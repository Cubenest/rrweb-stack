# @peekdev/connector-slack

Slack surface adapter for the peek connector platform. Connects a peek agent
to Slack via Bolt's Socket Mode, routing Assistant thread messages and `/peek`
slash commands to the connector core.

## Slack app setup

### Required scopes

Bot token scopes the connector actually uses:

| Scope | Why |
|---|---|
| `assistant:write` | Register the app as an AI assistant + set suggested prompts |
| `chat:write` | Post replies, consent cards, journey summaries, and the "thinking…" status |
| `files:write` | `files.uploadV2` — `share_session` + journey artifacts |
| `files:read` | `files.info` — resolve the session-journey canvas permalink |
| `canvases:write` | `conversations.canvases.create` — session journey as a Slack canvas |
| `im:history` | Read the user's messages in the assistant thread / DM |
| `app_mentions:read` | `@peek` in a channel (team debugging) |
| `commands` | Receive the `/peek` slash command |

Event subscriptions: `assistant_thread_started`, `assistant_thread_context_changed`,
`message.im`, `app_mention`.

### Slack app scope — `chat:write`

The assistant "thinking…" status calls `assistant.threads.setStatus`. Slack is
migrating this capability from the `assistant:write` scope to `chat:write`. Add
**`chat:write`** to the bot token scopes in your Slack app manifest. Without it
the status is silently skipped (the turn still works); every other message uses
`chat.postMessage`, which also requires `chat:write`.

## Usage

```ts
import { SlackAdapter } from '@peekdev/connector-slack';

const adapter = new SlackAdapter({
  slackBotToken: process.env.SLACK_BOT_TOKEN,
  slackAppToken: process.env.SLACK_APP_TOKEN,
});

adapter.onMessage(async (msg) => {
  // Handle inbound messages from Slack
});

await adapter.start();
```

## Run it (recommended: via the peek CLI)

This connector ships **pre-bundled inside `@peekdev/cli`**, so the fastest path
needs no clone and no build:

```sh
npm i -g @peekdev/cli
peek connect add slack      # resolves the bundled connector — no --local needed
peek connect start
```

`peek connect add slack` spawns `node <cli>/dist/connectors/slack.js` (a single
esbuild bundle of this package). The only external is the native keychain module
`@napi-rs/keyring`, which `@peekdev/cli` installs as a dependency.

## Run from a local build (development)

For working on the connector itself, run it from a local build, spawned by the
`peek connect` daemon.

1. Build the connector:

   ```sh
   pnpm --filter @peekdev/connector-slack build
   ```

2. Register it with peek using the `--local` shorthand (resolves the path to
   an absolute path and sets `command=node`):

   ```sh
   peek connect add slack --local <repo>/packages/connector-slack/dist/index.js
   ```

3. Start the daemon:

   ```sh
   peek connect start
   ```

**Notes:**

- Slack tokens (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) are captured
  interactively on first run and stored in the system keychain (SP6b-1); you
  do not need to set them manually after the first interactive run.
- The daemon inherits `PEEK_LLM_*` and `PEEK_MCP_COMMAND` from the shell
  that ran `peek connect start` — set those in your shell profile before
  starting the daemon.
- Pairing with the browser extension happens via the extension side panel
  after the daemon is running.
