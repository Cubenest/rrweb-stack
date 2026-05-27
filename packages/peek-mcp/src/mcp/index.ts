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

  // Resolve when the client disconnects (stdin EOF). McpServer.connect
  // (Protocol.connect) PRESERVES and chains a pre-existing transport.onclose:
  // it captures the current handler and invokes it before its own internal
  // teardown. So we set it ONCE here, before connect — setting it again after
  // connect would clobber the SDK's chained cleanup. The read-only DB handle is
  // released in the same callback.
  const closed = new Promise<void>((resolve) => {
    transport.onclose = () => {
      peek.close();
      resolve();
    };
  });

  await peek.server.connect(transport);

  // `connect` returns once the transport is started; the process stays alive on
  // the open stdio streams until the client closes them. Block for that.
  await closed;
}

export {
  createPeekMcpServer,
  PEEK_MCP_TOOLS,
  SERVER_NAME,
  type CreatePeekMcpServerOptions,
  type PeekMcpServer,
} from './server.js';
