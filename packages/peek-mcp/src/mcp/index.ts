// MCP-mode entry (Task 3.11, ADR-0011): construct the peek MCP server and
// connect it over a single StdioServerTransport — the only transport peek
// exposes in v1. Invoked from src/index.ts when `peek-mcp` runs without
// --native-host and without a chrome-extension:// origin arg.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type CreatePeekMcpServerOptions, createPeekMcpServer } from './server.js';

/**
 * Start the peek MCP stdio server and resolve when the transport closes (the
 * client disconnected — stdin EOF). The DB handle is released on close.
 */
export async function runMcpServer(options: CreatePeekMcpServerOptions = {}): Promise<void> {
  const peek = createPeekMcpServer(options);
  const transport = new StdioServerTransport();

  // Release the read-only DB handle when the client disconnects.
  const close = (): void => peek.close();
  transport.onclose = close;

  await peek.server.connect(transport);

  // `connect` returns once the transport is started; the process then stays
  // alive on the open stdio streams until the client closes them. Await a
  // promise that resolves on transport close so the caller's `await` blocks
  // for the server's lifetime.
  await new Promise<void>((resolve) => {
    transport.onclose = () => {
      close();
      resolve();
    };
  });
}

export {
  createPeekMcpServer,
  PEEK_MCP_TOOLS,
  SERVER_NAME,
  type CreatePeekMcpServerOptions,
  type PeekMcpServer,
} from './server.js';
