import type Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolKind } from './types.js';

const ACTION_TOOLS = new Set(['execute_action', 'request_authorization']);

const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(timerId)), timeout]);
}

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

// The elicitation capability we advertise at construction, kept as a constant so
// capabilities() can reflect it without re-reading private Client internals.
const ELICITATION_CAPS = { elicitation: { form: {} } } as const;

export class PeekMcp {
  private client: Client;
  private transport: StdioClientTransport;
  // The connector secret obtained after pairing. When set, it is injected into
  // every execute_action call so peek-mcp can verify the connector's identity
  // without showing a banner. The connector ID is derived by peek-mcp from the
  // MCP client name (clientName arg to constructor, e.g. 'peek-slack') via
  // connectorIdFromClientName — pairing must use the same client name as the
  // connection for verification to succeed.
  #connectorSecret?: string;

  constructor(spawn: McpSpawn, clientName: string) {
    this.transport = new StdioClientTransport({ command: spawn.command, args: spawn.args });
    // Advertise elicitation.form so peek-mcp can drive delegated consent
    // (server checks _clientCapabilities?.elicitation?.form specifically).
    this.client = new Client(
      { name: clientName, version: '0.1.0' },
      { capabilities: ELICITATION_CAPS },
    );
  }

  /** Store the connector secret so it is attached to every execute_action call. */
  setConnectorSecret(secret: string): void {
    this.#connectorSecret = secret;
  }

  /**
   * Request pairing approval from peek-mcp.
   * Calls the `request_pairing` tool with the provided 4-digit code and
   * returns the parsed `{ approved, secret? }` response.
   */
  async requestPairing(code: string): Promise<{ approved: boolean; secret?: string }> {
    const text = await this.callTool('request_pairing', { code });
    try {
      return JSON.parse(text) as { approved: boolean; secret?: string };
    } catch {
      return { approved: false };
    }
  }

  /** Returns the capability object this client was constructed with (test seam). */
  capabilities(): typeof ELICITATION_CAPS {
    return ELICITATION_CAPS;
  }

  /**
   * Test seam: replace the client's setRequestHandler so tests can capture
   * registered handlers without spawning a real transport.
   * @internal
   */
  __setRequestHandlerForTest(override: (schema: unknown, handler: unknown) => void): void {
    this.client.setRequestHandler = override as typeof this.client.setRequestHandler;
  }

  /**
   * Test seam: override what the client sends so tests can capture the
   * resolved input (after connectorSecret injection) without a real transport.
   * The override receives the request object as `client.callTool` would.
   * @internal
   */
  __overrideClientCallToolForTest(
    override: (req: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>,
  ): void {
    this.client.callTool = override as typeof this.client.callTool;
  }

  /** Register a handler for peek-mcp's server->client elicitInput. `handler`
   *  returns the human verdict; onElicit maps it into the MCP ElicitResult. */
  onElicit(handler: (message: string) => Promise<'accept' | 'decline' | 'cancel'>): void {
    this.client.setRequestHandler(ElicitRequestSchema, async (req) => ({
      action: await handler(req.params.message),
    }));
  }

  async connect(): Promise<void> {
    try {
      await withTimeout(this.client.connect(this.transport), CONNECT_TIMEOUT_MS, 'mcp connect');
    } catch (err) {
      // StdioClientTransport spawns the child process during connect; on a
      // timeout or failed handshake the MCP SDK does not reliably kill it, so
      // close the transport explicitly to avoid leaking an orphan subprocess.
      // Cleanup errors are swallowed so they don't mask the original failure.
      await this.transport.close().catch(() => undefined);
      throw err;
    }
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
    // Inject connectorSecret into execute_action calls when a secret is set.
    // Spread a copy so the caller's object is never mutated.
    const resolvedInput =
      name === 'execute_action' && this.#connectorSecret !== undefined
        ? { ...(input as Record<string, unknown>), connectorSecret: this.#connectorSecret }
        : input;
    const result = await withTimeout(
      this.client.callTool({
        name,
        arguments: (resolvedInput ?? {}) as Record<string, unknown>,
      }),
      CALL_TIMEOUT_MS,
      `mcp callTool(${name})`,
    );
    return mcpResultToText(result as { content: Array<{ type: string; text?: string }> });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
