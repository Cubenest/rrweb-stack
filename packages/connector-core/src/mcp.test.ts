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
