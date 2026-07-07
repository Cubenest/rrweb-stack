#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk';
import {
  ConnectorRuntime,
  PeekMcp,
  SdkBrain,
  SessionStore,
  assertNodeVersion,
  defaultSecretPath,
  loadBrainConfig,
  loadMcpConfig,
  loadPairingSecret,
  savePairingSecret,
} from '@peekdev/connector-core';
import { loadSlackConfig } from './config.js';
import { maybePair } from './pairing.js';
import { SlackAdapter } from './slack-adapter.js';

async function main(): Promise<void> {
  assertNodeVersion(process.version);
  const brainConfig = loadBrainConfig(process.env);
  const mcpConfig = loadMcpConfig(process.env);
  const slackConfig = loadSlackConfig(process.env);

  const secretPath = defaultSecretPath('slack');
  const secretStore = {
    secretPath,
    load: loadPairingSecret,
    save: savePairingSecret,
  };

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

  const store = new SessionStore(() => brain.newSession());
  const adapter = new SlackAdapter(slackConfig);
  const runtime = new ConnectorRuntime({ adapter, brain, mcp, store, secretStore });

  // Check for an existing pairing secret before start() loads it, so we can
  // decide below whether to run the first-run pairing flow.
  const existingSecret = await secretStore.load(secretPath);
  await runtime.start();

  const isPaired = existingSecret !== null;
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
