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

  it('throws when tool-use turns exceed maxTurns', async () => {
    // createMessage always returns a read tool_use (so the loop never exits naturally)
    const alwaysReadToolUse = vi.fn().mockResolvedValue(
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
    );
    const brain = new SdkBrain({
      createMessage: alwaysReadToolUse,
      callTool: vi.fn().mockResolvedValue('x'),
      tools,
      model: 'm',
      extendedReasoning: false,
      maxTurns: 3,
    });
    await expect(brain.runTurn(brain.newSession())).rejects.toThrow(/exceeded 3/);
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

describe('SdkBrain multi-tool turn (local-endpoint safety)', () => {
  const readAction = (): Anthropic.Message =>
    msg(
      [
        {
          type: 'tool_use',
          id: 'r1',
          name: 'get_session_summary',
          input: {},
          caller: { type: 'direct' },
        },
        {
          type: 'tool_use',
          id: 'a1',
          name: 'execute_action',
          input: { x: 1 },
          caller: { type: 'direct' },
        },
      ],
      'tool_use',
    );

  it('suspends on the first action and does NOT execute sibling reads', async () => {
    const createMessage = vi.fn().mockResolvedValue(readAction());
    const callTool = vi.fn();
    const brain = new SdkBrain({
      createMessage,
      callTool,
      tools,
      model: 'm',
      extendedReasoning: false,
    });
    const out = await brain.runTurn(brain.newSession());
    expect(out).toMatchObject({
      kind: 'consent',
      action: { toolUseId: 'a1', toolName: 'execute_action' },
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('appendToolResult completes EVERY tool_use from the suspended turn (no orphan)', async () => {
    const brain = new SdkBrain({
      createMessage: vi.fn().mockResolvedValue(readAction()),
      callTool: vi.fn(),
      tools,
      model: 'm',
      extendedReasoning: false,
    });
    const s = brain.newSession();
    await brain.runTurn(s);
    brain.appendToolResult(s, 'a1', 'ok', false);
    const history = s.history as Anthropic.MessageParam[];
    const last = history.at(-1) as { role: string; content: Anthropic.ToolResultBlockParam[] };
    expect(last.role).toBe('user');
    expect(last.content.map((b) => b.tool_use_id).sort()).toEqual(['a1', 'r1']);
    expect(last.content.find((b) => b.tool_use_id === 'r1')?.is_error).toBe(true);
    const a1 = last.content.find((b) => b.tool_use_id === 'a1');
    expect(a1?.content).toBe('ok');
    expect(a1?.is_error).toBeUndefined();
  });

  it('enforces <=1 action per turn: the second action is stubbed, not executed', async () => {
    const twoActions = msg(
      [
        {
          type: 'tool_use',
          id: 'a1',
          name: 'execute_action',
          input: { x: 1 },
          caller: { type: 'direct' },
        },
        {
          type: 'tool_use',
          id: 'a2',
          name: 'execute_action',
          input: { y: 2 },
          caller: { type: 'direct' },
        },
      ],
      'tool_use',
    );
    const brain = new SdkBrain({
      createMessage: vi.fn().mockResolvedValue(twoActions),
      callTool: vi.fn(),
      tools,
      model: 'm',
      extendedReasoning: false,
    });
    const s = brain.newSession();
    const out = await brain.runTurn(s);
    expect(out).toMatchObject({ kind: 'consent', action: { toolUseId: 'a1' } });
    brain.appendToolResult(s, 'a1', 'done', false);
    const last = (s.history as Anthropic.MessageParam[]).at(-1) as {
      content: Anthropic.ToolResultBlockParam[];
    };
    expect(last.content.find((b) => b.tool_use_id === 'a2')?.is_error).toBe(true);
  });

  it('resumes cleanly after a multi-tool suspend — the next createMessage sees a complete turn', async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(readAction())
      .mockResolvedValueOnce(msg([{ type: 'text', text: 'done', citations: [] }], 'end_turn'));
    const brain = new SdkBrain({
      createMessage,
      callTool: vi.fn().mockResolvedValue('ok'),
      tools,
      model: 'm',
      extendedReasoning: false,
    });
    const s = brain.newSession();
    await brain.runTurn(s);
    brain.appendToolResult(s, 'a1', 'ok', false);
    const out = await brain.runTurn(s);
    expect(out).toEqual({ kind: 'done', text: 'done' });
    const secondReq = createMessage.mock.calls[1]?.[0] as Anthropic.MessageCreateParamsNonStreaming;
    const msgs = secondReq.messages;
    const idx = msgs.findIndex(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((b) => (b as { type: string }).type === 'tool_use'),
    );
    const assistant = msgs[idx] as { content: Array<{ type: string; id?: string }> };
    const userAfter = msgs[idx + 1] as { content: Anthropic.ToolResultBlockParam[] };
    const toolUseIds = assistant.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => b.id)
      .sort();
    const resultIds = userAfter.content.map((b) => b.tool_use_id).sort();
    expect(resultIds).toEqual(toolUseIds);
  });
});
