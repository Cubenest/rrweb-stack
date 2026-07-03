import type Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolKind } from './types.js';

const ACTION_TOOLS = new Set(['execute_action', 'request_authorization']);

export function classify(toolName: string): ToolKind {
  return ACTION_TOOLS.has(toolName) ? 'action' : 'read';
}

export function mcpToolToAnthropic(tool: {
  name: string;
  description?: string;
  inputSchema: object;
}): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description ?? tool.name,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

export function mcpResultToText(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return result.content
    .map((block) => (block.type === 'text' ? (block.text ?? '') : JSON.stringify(block)))
    .join('\n');
}

export interface McpSpawn {
  command: string;
  args: string[];
}

export class PeekMcp {
  private client: Client;
  private transport: StdioClientTransport;

  constructor(spawn: McpSpawn, clientName: string) {
    this.transport = new StdioClientTransport({ command: spawn.command, args: spawn.args });
    this.client = new Client({ name: clientName, version: '0.1.0' });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<Anthropic.Tool[]> {
    const { tools } = await this.client.listTools();
    return tools.map((t) =>
      mcpToolToAnthropic({
        name: t.name,
        ...(t.description !== undefined ? { description: t.description } : {}),
        inputSchema: t.inputSchema,
      }),
    );
  }

  async callTool(name: string, input: unknown): Promise<string> {
    const result = await this.client.callTool({
      name,
      arguments: (input ?? {}) as Record<string, unknown>,
    });
    return mcpResultToText(result as { content: Array<{ type: string; text?: string }> });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
