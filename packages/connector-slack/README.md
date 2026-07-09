# @peekdev/connector-slack

Slack surface adapter for the peek connector platform. Connects a peek agent
to Slack via Bolt's Socket Mode, routing Assistant thread messages and `/peek`
slash commands to the connector core.

## Slack app setup

### Required scopes

| Scope | Why |
|---|---|
| `assistant:write` | Required to register the app as an AI assistant in Slack |
| `chat:write` | Required to post messages and set the "thinking…" status |

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
