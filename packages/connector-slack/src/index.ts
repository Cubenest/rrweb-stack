#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk';
import {
  ConnectorRuntime,
  PeekMcp,
  SdkBrain,
  SessionStore,
  assertNodeVersion,
  loadBrainConfig,
  loadMcpConfig,
} from '@peekdev/connector-core';
import { buildBootstrapStore, resolvePairedState } from './bootstrap.js';
import { loadSlackConfig } from './config.js';
import { maybePair } from './pairing.js';
import { SlackAdapter } from './slack-adapter.js';

async function main(): Promise<void> {
  assertNodeVersion(process.version);
  const brainConfig = loadBrainConfig(process.env);
  const mcpConfig = loadMcpConfig(process.env);
  const slackConfig = loadSlackConfig(process.env);

  // Build the SecretStore (keychain by default; file store when unavailable or
  // PEEK_INSECURE_STORE=1 / --insecure-store flag is set) and silently migrate
  // any SP4-era ~/.config/peek-slack/pairing.json into the new store.
  const insecureStore =
    process.env.PEEK_INSECURE_STORE === '1' || process.argv.includes('--insecure-store');
  const secretStore = await buildBootstrapStore({ insecureStore });

  const mcp = new PeekMcp(mcpConfig, 'peek-slack');
  await mcp.connect();
  const tools = await mcp.listTools();

  const anthropic = new Anthropic({
    apiKey: brainConfig.apiKey,
    baseURL: brainConfig.baseURL,
  });
  const brain = new SdkBrain({
    createMessage: (req) => anthropic.messages.create(req),
    callTool: (name, input) => mcp.callTool(name, input),
    tools,
    model: brainConfig.model,
    extendedReasoning: !brainConfig.baseURL,
    delegateActionConsent: true,
  });

  const sessionStore = new SessionStore(() => brain.newSession());
  const adapter = new SlackAdapter(slackConfig);
  const runtime = new ConnectorRuntime({ adapter, brain, mcp, store: sessionStore, secretStore });

  // Determine paired-state before start() so we can decide whether to run the
  // first-run pairing flow. start() re-reads the same secret to arm the MCP
  // client; both reads are idempotent against the same store.
  const isPaired = await resolvePairedState(secretStore, 'peek-slack');
  await runtime.start();

  await maybePair(runtime, isPaired, async (code) => {
    console.log(`[peek-slack] Pairing code: ${code} — approve it in the peek extension`);
    // Post the code to Slack only when a channel is available. The Slack
    // assistant thread context is not yet established at startup, so we log
    // and rely on the operator reading the terminal output. A channel-based
    // announcement can be added once a default channel config is available.
  });

  console.log(
    `peek-slack running — ${tools.length} peek tools · model ${brainConfig.model}${
      brainConfig.baseURL ? ` via ${brainConfig.baseURL}` : ''
    }`,
  );

  const shutdown = async () => {
    try {
      await adapter.stop();
      await mcp.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('peek-slack failed to start:', err);
  process.exit(1);
});
