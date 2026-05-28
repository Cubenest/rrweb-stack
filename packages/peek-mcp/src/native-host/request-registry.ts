// Correlated-request registry for the MCP host (Task 3.24).
//
// `execute_action` and `request_authorization` are inherently asynchronous over
// the native port: the MCP tool handler sends an `action.request` to the SW,
// and the SW eventually replies with a `action.verdict` / `action.result`. The
// reply can take seconds (Level-3 banner waits on user click), and multiple
// requests can be in flight concurrently across MCP clients.
//
// We assign a UUID per request, store `{ resolve, reject, timer }` keyed by
// that id, and the host's inbound-message handler looks up the id and resolves
// the pending promise. Time out after `timeoutMs` so a wedged SW never leaves
// the MCP tool handler waiting forever.
//
// Pure JS — no `chrome.*`, no node-native deps — so it unit-tests cleanly.

export interface PendingRequest<T> {
  /** Resolve the awaiting tool handler with the SW's reply payload. */
  resolve(value: T): void;
  /** Reject the awaiting tool handler (timeout or transport error). */
  reject(reason: unknown): void;
  /** Timer handle so we can cancel on resolve / reject. */
  timer: unknown;
}

export interface RequestRegistryDeps {
  /** Generate a fresh, unique request id (UUID v4 in production). */
  generateId(): string;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Default deps using node's globals + crypto.randomUUID. */
export const defaultRegistryDeps: RequestRegistryDeps = {
  generateId: () => globalThis.crypto.randomUUID(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Sentinel error thrown when a request times out without a reply. */
export class RequestTimeoutError extends Error {
  constructor(
    readonly requestId: string,
    readonly timeoutMs: number,
  ) {
    super(`peek: request ${requestId} timed out after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * Tracks in-flight host→SW requests by id. The host's tool handler:
 *
 *   const { id, response } = registry.create<MyReply>(5 * 60_000);
 *   await transport.send({ type: 'action.request', requestId: id, ... });
 *   return await response;          // resolves on action.result, rejects on timeout
 *
 * The host's inbound-message handler calls `registry.resolve(id, payload)` or
 * `registry.reject(id, err)` when the SW replies. Unknown ids are silently
 * dropped (a stale reply after a timeout shouldn't crash the host).
 */
export class RequestRegistry {
  readonly #deps: RequestRegistryDeps;
  readonly #pending = new Map<string, PendingRequest<unknown>>();

  constructor(deps: RequestRegistryDeps = defaultRegistryDeps) {
    this.#deps = deps;
  }

  /**
   * Allocate a request: returns the `id` and a `response` promise the caller
   * awaits. The promise rejects with {@link RequestTimeoutError} after
   * `timeoutMs` if no resolve/reject has arrived.
   */
  create<T>(timeoutMs: number): { id: string; response: Promise<T> } {
    const id = this.#deps.generateId();
    let resolveFn!: (value: T) => void;
    let rejectFn!: (reason: unknown) => void;
    const response = new Promise<T>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    const timer = this.#deps.setTimeout(() => {
      const pending = this.#pending.get(id);
      if (!pending) return; // already resolved/rejected
      this.#pending.delete(id);
      pending.reject(new RequestTimeoutError(id, timeoutMs));
    }, timeoutMs);
    this.#pending.set(id, {
      resolve: resolveFn as (value: unknown) => void,
      reject: rejectFn,
      timer,
    });
    return { id, response };
  }

  /** Resolve the request with `payload`. Unknown id → no-op (drop stale reply). */
  resolve(id: string, payload: unknown): boolean {
    const pending = this.#pending.get(id);
    if (!pending) return false;
    this.#pending.delete(id);
    this.#deps.clearTimeout(pending.timer);
    pending.resolve(payload);
    return true;
  }

  /** Reject the request with `reason`. Unknown id → no-op. */
  reject(id: string, reason: unknown): boolean {
    const pending = this.#pending.get(id);
    if (!pending) return false;
    this.#pending.delete(id);
    this.#deps.clearTimeout(pending.timer);
    pending.reject(reason);
    return true;
  }

  /** Reject every pending request (used on transport teardown). */
  rejectAll(reason: unknown): number {
    const count = this.#pending.size;
    for (const [id, pending] of this.#pending.entries()) {
      this.#deps.clearTimeout(pending.timer);
      pending.reject(reason);
      this.#pending.delete(id);
    }
    return count;
  }

  /** Number of in-flight requests (diagnostics). */
  get pendingCount(): number {
    return this.#pending.size;
  }
}
