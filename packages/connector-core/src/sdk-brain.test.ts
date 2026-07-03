import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { SdkBrain } from './sdk-brain.js';

function msg(
  content: Anthropic.ContentBlock[],
  stop: Anthropic.Message['stop_reason'],
): Anthropic.Message {
  return {
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'x',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as Anthropic.Message;
}

const tools: Anthropic.Tool[] = [];

describe('SdkBrain.runTurn', () => {
  it('returns done text on a non-tool stop', async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValue(msg([{ type: 'text', text: 'hello', citations: [] }], 'end_turn'));
    const callTool = vi.fn();
    const brain = new SdkBrain({
      createMessage,
      callTool,
      tools,
      model: 'm',
      extendedReasoning: false,
    });
    const s = brain.newSession();
    brain.appendUserText(s, 'hi');
    const out = await brain.runTurn(s);
    expect(out).toEqual({ kind: 'done', text: 'hello' });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('auto-runs a read tool then continues', async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(
        msg(
          [
            {
              type: 'tool_use',
              id: 'u1',
              name: 'get_session_summary',
              input: {},
              caller: { type: 'direct' },
            },
          ],
          'tool_use',
        ),
      )
      .mockResolvedValueOnce(msg([{ type: 'text', text: 'done', citations: [] }], 'end_turn'));
    const callTool = vi.fn().mockResolvedValue('summary');
    const brain = new SdkBrain({
      createMessage,
      callTool,
      tools,
      model: 'm',
      extendedReasoning: false,
    });
    const s = brain.newSession();
    const out = await brain.runTurn(s);
    expect(callTool).toHaveBeenCalledWith('get_session_summary', {});
    expect(out).toEqual({ kind: 'done', text: 'done' });
  });

  it('suspends on the first action tool without executing', async () => {
    const createMessage = vi.fn().mockResolvedValue(
      msg(
        [
          {
            type: 'tool_use',
            id: 'u1',
            name: 'execute_action',
            input: { a: 1 },
            caller: { type: 'direct' },
          },
        ],
        'tool_use',
      ),
    );
    const callTool = vi.fn();
    const brain = new SdkBrain({
      createMessage,
      callTool,
      tools,
      model: 'm',
      extendedReasoning: false,
    });
    const s = brain.newSession();
    const out = await brain.runTurn(s);
    expect(callTool).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      kind: 'consent',
      action: { toolUseId: 'u1', toolName: 'execute_action', input: { a: 1 } },
    });
  });

  it('throws on a tool_use stop with no tool_use blocks', async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValue(msg([{ type: 'text', text: 'x', citations: [] }], 'tool_use'));
    const brain = new SdkBrain({
      createMessage,
      callTool: vi.fn(),
      tools,
      model: 'm',
      extendedReasoning: false,
    });
    await expect(brain.runTurn(brain.newSession())).rejects.toThrow(/no tool_use blocks/);
  });

  it('omits adaptive-thinking params when extendedReasoning is false', async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValue(msg([{ type: 'text', text: 'x', citations: [] }], 'end_turn'));
    const brain = new SdkBrain({
      createMessage,
      callTool: vi.fn(),
      tools,
      model: 'm',
      extendedReasoning: false,
    });
    await brain.runTurn(brain.newSession());
    const req = createMessage.mock.calls[0]?.[0];
    expect(req?.thinking).toBeUndefined();
    expect(req?.output_config).toBeUndefined();
    expect(req?.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
  });

  it('appendToolResult records an error tool_result on deny', () => {
    const brain = new SdkBrain({
      createMessage: vi.fn(),
      callTool: vi.fn(),
      tools,
      model: 'm',
      extendedReasoning: false,
    });
    const s = brain.newSession();
    brain.appendToolResult(s, 'u1', 'denied', true);
    const history = s.history as Anthropic.MessageParam[];
    expect(history.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'denied', is_error: true }],
    });
  });
});
