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
import { loadSlackConfig } from './config.js';
import { SlackAdapter } from './slack-adapter.js';

async function main(): Promise<void> {
  assertNodeVersion(process.version);
  const brainConfig = loadBrainConfig(process.env);
  const mcpConfig = loadMcpConfig(process.env);
  const slackConfig = loadSlackConfig(process.env);

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
  const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
  await runtime.start();

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
