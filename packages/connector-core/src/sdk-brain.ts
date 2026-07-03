import type Anthropic from '@anthropic-ai/sdk';
import type { AgentOutcome, Brain, Session } from './brain.js';
import { classify } from './mcp.js';

type Msg = Anthropic.MessageParam;

export interface SdkBrainDeps {
  createMessage: (req: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
  callTool: (name: string, input: unknown) => Promise<string>;
  tools: Anthropic.Tool[];
  model: string;
  /** Include Anthropic-only adaptive-thinking/effort params. False when routed via a gateway (e.g. OpenRouter). */
  extendedReasoning: boolean;
}

export class SdkBrain implements Brain {
  constructor(private readonly deps: SdkBrainDeps) {}

  newSession(): Session {
    return { history: [] };
  }

  appendUserText(session: Session, text: string): void {
    (session.history as Msg[]).push({ role: 'user', content: text });
  }

  appendToolResult(session: Session, toolUseId: string, text: string, isError: boolean): void {
    (session.history as Msg[]).push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: text,
          ...(isError ? { is_error: true } : {}),
        },
      ],
    });
  }

  async runTurn(session: Session): Promise<AgentOutcome> {
    const history = session.history as Msg[];
    const { createMessage, callTool, tools, model, extendedReasoning } = this.deps;

    for (;;) {
      const reasoning: Partial<Anthropic.MessageCreateParamsNonStreaming> = extendedReasoning
        ? { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }
        : {};
      const message = await createMessage({
        model,
        max_tokens: 16000,
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        tools,
        messages: history,
        ...reasoning,
      });

      history.push({ role: 'assistant', content: message.content });

      if (message.stop_reason !== 'tool_use') {
        const text = message.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        return { kind: 'done', text };
      }

      const toolUses = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (toolUses.length === 0) {
        throw new Error('Model returned a tool_use stop with no tool_use blocks');
      }

      const action = toolUses.find((t) => classify(t.name) === 'action');
      if (action) {
        return {
          kind: 'consent',
          action: {
            toolUseId: action.id,
            toolName: action.name,
            input: action.input,
            createdAt: Date.now(),
          },
        };
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tool of toolUses) {
        const content = await callTool(tool.name, tool.input);
        results.push({ type: 'tool_result', tool_use_id: tool.id, content });
      }
      history.push({ role: 'user', content: results });
    }
  }
}
