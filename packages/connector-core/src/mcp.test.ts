import { describe, expect, it } from 'vitest';
import { classify, mcpResultToText, mcpToolToAnthropic, withTimeout } from './mcp.js';

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
