import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { PeekMcp, classify, mcpResultToText, mcpToolToAnthropic, withTimeout } from './mcp.js';

describe('classify', () => {
  it('marks execute_action and request_authorization as action', () => {
    expect(classify('execute_action')).toBe('action');
    expect(classify('request_authorization')).toBe('action');
  });
  it('marks everything else as read', () => {
    expect(classify('get_session_summary')).toBe('read');
    expect(classify('list_recent_sessions')).toBe('read');
  });
});

describe('mcpToolToAnthropic', () => {
  it('maps name/description/inputSchema', () => {
    const t = mcpToolToAnthropic({ name: 'x', description: 'd', inputSchema: { type: 'object' } });
    expect(t).toEqual({ name: 'x', description: 'd', input_schema: { type: 'object' } });
  });
  it('falls back to name when description is missing', () => {
    const t = mcpToolToAnthropic({ name: 'x', inputSchema: {} });
    expect(t.description).toBe('x');
  });
});

describe('mcpResultToText', () => {
  it('joins text blocks and JSON-stringifies non-text', () => {
    const out = mcpResultToText({
      content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'z' } as { type: string }],
    });
    expect(out).toBe(`a\n${JSON.stringify({ type: 'image', data: 'z' })}`);
  });
});

describe('withTimeout', () => {
  it('resolves to the wrapped promise value when it settles in time', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000, 'x');
    expect(result).toBe(42);
  });
  it('rejects with a timed-out error when the promise takes too long', async () => {
    // Use a real 10ms timer — fast, but proves the race fires
    await expect(withTimeout(new Promise<never>(() => {}), 10, 'x')).rejects.toThrow(/timed out/);
  });
});

describe('PeekMcp connectorSecret injection', () => {
  // Intercept at the client.callTool level so the secret-injection code in
  // PeekMcp.callTool runs normally and we observe the resolved arguments.

  type ClientCallArgs = { name: string; arguments: Record<string, unknown> };

  function makeMcpWithClientSpy(clientName = 'peek-slack') {
    const mcp = new PeekMcp({ command: 'noop', args: [] }, clientName);
    const calls: ClientCallArgs[] = [];
    mcp.__overrideClientCallToolForTest(async (req) => {
      calls.push(req as ClientCallArgs);
      // Return a minimal MCP result shape so mcpResultToText doesn't blow up.
      return { content: [{ type: 'text', text: 'ok' }] };
    });
    return { mcp, calls };
  }

  it('omits connectorSecret when none has been set', async () => {
    const { mcp, calls } = makeMcpWithClientSpy();
    await mcp.callTool('execute_action', { verb: 'click', selector: '#btn' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments).not.toHaveProperty('connectorSecret');
  });

  it('merges connectorSecret into execute_action arguments when set', async () => {
    const { mcp, calls } = makeMcpWithClientSpy();
    mcp.setConnectorSecret('s3cr3t-abc');
    await mcp.callTool('execute_action', { verb: 'click', selector: '#btn' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments).toMatchObject({
      verb: 'click',
      selector: '#btn',
      connectorSecret: 's3cr3t-abc',
    });
  });

  it("does NOT mutate the caller's input object", async () => {
    const { mcp } = makeMcpWithClientSpy();
    mcp.setConnectorSecret('s3cr3t-xyz');
    const original = { verb: 'scroll', selector: 'body' };
    const snapshot = { ...original };
    await mcp.callTool('execute_action', original);
    expect(original).toEqual(snapshot); // original untouched
  });

  it('does NOT inject connectorSecret for non-execute_action tools', async () => {
    const { mcp, calls } = makeMcpWithClientSpy();
    mcp.setConnectorSecret('s3cr3t-abc');
    await mcp.callTool('get_session_summary', { sessionId: 'abc' });
    expect(calls[0]?.arguments).not.toHaveProperty('connectorSecret');
  });
});

describe('PeekMcp requestPairing', () => {
  function makeMcpWithFakeCallTool(result: string) {
    const mcp = new PeekMcp({ command: 'noop', args: [] }, 'peek-slack');
    const calls: Array<{ name: string; input: unknown }> = [];
    mcp.callTool = async (name: string, input: unknown) => {
      calls.push({ name, input });
      return result;
    };
    return { mcp, calls };
  }

  it('calls callTool with request_pairing and the provided code', async () => {
    const payload = JSON.stringify({ approved: true, secret: 'tok-42' });
    const { mcp, calls } = makeMcpWithFakeCallTool(payload);
    await mcp.requestPairing('4821');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ name: 'request_pairing', input: { code: '4821' } });
  });

  it('returns parsed { approved: true, secret } on approval', async () => {
    const payload = JSON.stringify({ approved: true, secret: 'tok-42' });
    const { mcp } = makeMcpWithFakeCallTool(payload);
    const result = await mcp.requestPairing('4821');
    expect(result).toEqual({ approved: true, secret: 'tok-42' });
  });

  it('returns { approved: false } when the server denies', async () => {
    const payload = JSON.stringify({ approved: false });
    const { mcp } = makeMcpWithFakeCallTool(payload);
    const result = await mcp.requestPairing('9999');
    expect(result).toEqual({ approved: false });
  });
});

describe('PeekMcp elicitation', () => {
  it('advertises elicitation.form so peek-mcp will not throw on elicitInput', () => {
    const mcp = new PeekMcp({ command: 'noop', args: [] }, 'peek-slack');
    // The Client is private; assert via the capabilities it was constructed with.
    // Expose a readable getter for the test (see impl): capabilities().
    expect(mcp.capabilities().elicitation).toEqual({ form: {} });
  });
  it('onElicit registers a handler that maps the surface decision to an action', async () => {
    const mcp = new PeekMcp({ command: 'noop', args: [] }, 'peek-slack');
    let registered: ((req: unknown) => Promise<{ action: string }>) | undefined;
    // Stub the client's setRequestHandler to capture the handler (see impl note).
    mcp.__setRequestHandlerForTest((schema, h) => {
      if (schema === ElicitRequestSchema) registered = h as never;
    });
    mcp.onElicit(async (message) => (message.includes('click') ? 'accept' : 'decline'));
    const res = await registered?.({ params: { message: 'run "click"' } });
    expect(res).toEqual({ action: 'accept' });
  });
});
