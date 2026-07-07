import type { ConnectorRuntime } from '@peekdev/connector-core';

/**
 * Invokes `runtime.pair(displayCode)` only when the connector is unpaired
 * (i.e. no persisted secret was loaded by `start()`).
 *
 * Extracted as a standalone function so the pairing decision can be unit-tested
 * without a live Slack connection.
 *
 * @param runtime    The connector runtime (must have been constructed with a secretStore).
 * @param isPaired   Pass `true` when `start()` loaded an existing secret; `false` otherwise.
 * @param displayCode  Callback that surfaces the generated code to the operator.
 */
export async function maybePair(
  runtime: ConnectorRuntime,
  isPaired: boolean,
  displayCode: (code: string) => void | Promise<void>,
): Promise<void> {
  if (!isPaired) {
    await runtime.pair(displayCode);
  }
}
