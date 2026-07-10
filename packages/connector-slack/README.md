# @peekdev/connector-slack

Slack surface adapter for the peek connector platform. Connects a peek agent to
Slack via Bolt's Socket Mode, routing Assistant-pane threads, `@peek` channel
mentions, DMs, and the `/peek` slash command to the connector core.

## Slack app setup

The connector runs over **Socket Mode**, so it needs a bot token (`xoxb-…`) and an
app-level token (`xapp-…`, scope `connections:write`). Each capability maps to a
specific bot-token scope below.

### Bot token scopes

| Scope | Why it's needed |
|---|---|
| `chat:write` | Post every reply, consent card, and the "thinking…" status (`chat.postMessage`, `assistant.threads.setStatus`). |
| `assistant:write` | Register the app as an AI assistant and set thread status / title / suggested prompts. |
| `app_mentions:read` | Receive `@peek …` mentions in a channel (the shared-debugging surface). |
| `channels:history` | Receive public-channel message events so a peek thread auto-continues without re-mentioning. |
| `groups:history` | Same, for private channels. |
| `im:history` | Receive direct-message events (the DM / Assistant 1:1 surface). |
| `files:write` | Upload a session bundle to the thread (`share_session` → `files.uploadV2`). |
| `canvases:write` | Create the session-journey canvas (`render_session_journey` → `conversations.canvases.create`). |
| `files:read` | Resolve the canvas permalink (`files.info`) so the journey posts a clickable link. Without it the journey silently falls back to a Block Kit summary. |
| `commands` | The `/peek` slash command. |

> Scope changes only take effect after you **reinstall** the app to the workspace.

### Event subscriptions (bot events)

Subscribe the bot to:

- `app_mention` — `@peek` in a channel.
- `message.channels` / `message.groups` — channel / private-channel messages (thread auto-continue).
- `message.im` — direct messages.

Assistant-thread events come with the **Agents & Assistants** feature — enable it if you
use the Assistant pane.

### Note — `chat:write` vs `assistant:write`

The assistant "thinking…" status calls `assistant.threads.setStatus`. Slack is migrating
this capability from `assistant:write` to `chat:write`, so keep **both**. Without
`chat:write` the status is silently skipped (the turn still works); every reply uses
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

## Run from a local build (no npm publish)

`@peekdev/connector-slack` is not published to npm — it runs from a local
build, spawned by the `peek connect` daemon.

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
