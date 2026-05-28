// MCP-process ↔ native-host-process bridge (Task 3.24).
//
// Architecture note (and an HONEST design boundary):
//
//   • The `peek-mcp` binary serves TWO roles via argv dispatch (see
//     src/index.ts): the **native host** process (owns ~/.peek/sessions.db
//     and the chrome.runtime.connectNative port), and the **MCP server**
//     process (an AI client like Cursor spawns it over stdio).
//   • For act-tool execution, the MCP server has to TELL the native host
//     "ask the SW to do X". Two processes — they need IPC.
//   • The two processes share ~/.peek/. The simplest cross-platform IPC for
//     a local-only design is a Unix domain socket on macOS/Linux (`~/.peek/
//     host.sock`) and a named pipe on Windows. That bridge lives outside
//     this chunk's scope — it's part of the action-execution E2E that the
//     brief explicitly marks as E2E-deferred.
//
//   This module defines:
//     1. The `HostBridge` interface every layer above calls — the seam
//        action-tool handlers depend on. PURE: in/out promises.
//     2. A {@link MissingHostBridge} default that throws a clear "bridge not
//        wired in this process" error. Used until the IPC implementation
//        lands; lets the MCP server CONSTRUCT cleanly + lets tests inject
//        a fake.
//     3. A {@link RegistryBackedHostBridge} test/integration helper that
//        wraps a {@link RequestRegistry} so tests can simulate the host
//        side without real IPC.
//
//   When the IPC layer lands (3d-4 or 3e) we add a concrete
//   `LocalSocketHostBridge` here; nothing else changes.

import { RequestRegistry, type RequestRegistryDeps } from '../native-host/request-registry.js';
import type { Action } from './action-schema.js';

/** Input the MCP tool handler hands the bridge. */
export interface HostActionRequest {
  /** 'execute_action' | 'request_authorization' — picks audit shape + UX. */
  readonly tool: 'execute_action' | 'request_authorization';
  readonly sessionId: string;
  readonly action: Action;
  /** MCP client name (from clientInfo). */
  readonly client: string;
  /**
   * Time the bridge waits before failing the await (5min default — longer
   * than any plausible Level-3 banner decision). Defaults applied at the
   * call site, not here, so different tools can use different budgets.
   */
  readonly timeoutMs?: number;
  /**
   * A pre-existing confirmation token from a prior `request_authorization`
   * call. Only meaningful for `tool === 'execute_action'`: the host can use
   * it to skip the banner step. NULL/undefined → no token (auth still happens).
   */
  readonly confirmToken?: string;
}

/** Reply the bridge yields to the MCP tool handler. */
export interface HostActionResponse {
  /** verdict + result from the SW (see action-protocol.ts ActionResultMessage). */
  readonly verdict: 'allow' | 'deny';
  readonly result: 'ok' | 'denied' | 'error';
  readonly approver: 'user' | 'allow-list-match' | 'level-4-auto';
  readonly approvalMs?: number;
  readonly destructiveTerm?: string;
  readonly details?: unknown;
  readonly error?: string;
  /**
   * For `request_authorization`: a one-shot token the AI then passes to
   * `execute_action`. Opaque; the host validates.
   */
  readonly confirmToken?: string;
}

/**
 * The bridge contract. The MCP tool handler awaits this; an implementation
 * relays the request to the SW + waits for the verdict.
 */
export interface HostBridge {
  request(req: HostActionRequest): Promise<HostActionResponse>;
}

/**
 * Default placeholder used when the IPC layer hasn't been wired in this
 * process (e.g. an MCP server started without a co-running native host).
 *
 * Every act-tool call resolves with `denied` + a clear error message so the
 * AI sees a structured failure rather than the tool throwing. The audit log
 * still records the attempt at the tool-handler layer.
 */
export class MissingHostBridge implements HostBridge {
  readonly #reason: string;
  constructor(reason = 'native-host bridge not wired in this MCP process') {
    this.#reason = reason;
  }
  async request(_req: HostActionRequest): Promise<HostActionResponse> {
    return {
      verdict: 'deny',
      result: 'denied',
      approver: 'user',
      error: this.#reason,
    };
  }
}

/**
 * A bridge backed by a {@link RequestRegistry}. The MCP tool handler's call
 * registers a pending request; tests (or a future IPC implementation) call
 * `resolveRequest` / `rejectRequest` to drive the reply. Used directly in
 * `server.test.ts` to exercise the act-tool handlers without real IPC.
 */
export class RegistryBackedHostBridge implements HostBridge {
  readonly #registry: RequestRegistry;
  /** FIFO queue of {id, req} pairs awaiting resolution — exposed for tests. */
  readonly pending: Array<{ id: string; req: HostActionRequest }> = [];

  constructor(registry?: RequestRegistry, deps?: RequestRegistryDeps) {
    this.#registry = registry ?? new RequestRegistry(deps);
  }

  async request(req: HostActionRequest): Promise<HostActionResponse> {
    const { id, response } = this.#registry.create<HostActionResponse>(req.timeoutMs ?? 5 * 60_000);
    this.pending.push({ id, req });
    return response;
  }

  /** Test helper: resolve the first pending request. */
  resolveNext(payload: HostActionResponse): boolean {
    const entry = this.pending.shift();
    if (!entry) return false;
    return this.#registry.resolve(entry.id, payload);
  }

  /** Test helper: reject the first pending request. */
  rejectNext(reason: unknown): boolean {
    const entry = this.pending.shift();
    if (!entry) return false;
    return this.#registry.reject(entry.id, reason);
  }
}
