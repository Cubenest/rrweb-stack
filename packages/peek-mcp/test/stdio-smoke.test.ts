// End-to-end stdio smoke (Task 3.11 verification): spawn the BUILT bin over a
// real child-process stdio pipe, complete the MCP initialize handshake, and
// assert tools/list returns the documented peek tool surface (13:
// 8 read + 2 act + 2 suggest + 1 handoff). This is the closest thing to how an
// AI tool (Claude Code / Cursor) actually launches `npx -y @peekdev/mcp`.
//
// Requires `dist/index.js` to exist — the test skips with a clear message if the
// package hasn't been built (CI runs build before test).

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const distEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const built = existsSync(distEntry);

interface Rpc {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: { tools?: Array<{ name: string }>; serverInfo?: { name: string } };
}

/** A minimal newline-delimited JSON-RPC client over a child's stdio. */
class StdioRpc {
  private buf = '';
  private readonly pending = new Map<number, (msg: Rpc) => void>();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard line-splitter loop
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as Rpc;
      if (typeof msg.id === 'number') this.pending.get(msg.id)?.(msg);
    }
  }

  notify(method: string, params?: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  request(id: number, method: string, params?: unknown): Promise<Rpc> {
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
}

let home: string;
let child: ChildProcessWithoutNullStreams | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-stdio-'));
});
afterEach(() => {
  child?.kill();
  child = undefined;
  rmSync(home, { recursive: true, force: true });
});

describe.skipIf(!built)('peek-mcp stdio smoke (built bin)', () => {
  it('completes initialize + tools/list over real stdio, returning all 13 tools', async () => {
    child = spawn(process.execPath, [distEntry], {
      env: { ...process.env, PEEK_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    const rpc = new StdioRpc(child);

    const init = await rpc.request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-smoke', version: '0' },
    });
    expect(init.result?.serverInfo?.name).toBe('peek-mcp');

    rpc.notify('notifications/initialized');

    const list = await rpc.request(2, 'tools/list', {});
    const names = (list.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        // Read tools (Phase 3c).
        'generate_playwright_repro',
        'get_dom_snapshot',
        'get_session_console_errors',
        'get_session_network_errors',
        'get_session_summary',
        'get_user_action_before_error',
        'list_recent_sessions',
        'query_dom_history',
        // Write tools (Phase 3d, Level 3+).
        'execute_action',
        'request_authorization',
        // Suggest tools (Level 2+ — non-mutating highlight overlay).
        'clear_highlight',
        'suggest_element',
        // Input handoff (Plan B — Level 4 with the control shield up).
        'request_user_input',
      ].sort(),
    );
  });

  it('exits cleanly when stdin closes (natural lifecycle, ADR-0011)', async () => {
    child = spawn(process.execPath, [distEntry], {
      env: { ...process.env, PEEK_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    const rpc = new StdioRpc(child);
    await rpc.request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-smoke', version: '0' },
    });

    const exited = new Promise<number>((resolve) => {
      child?.on('exit', (code) => resolve(code ?? -1));
    });
    child.stdin.end(); // EOF — the server should tear down and exit.
    const code = await exited;
    expect(code).toBe(0);
    child = undefined; // already exited
  });
});
