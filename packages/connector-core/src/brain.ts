/** Opaque to the runtime. The element shape is owned entirely by the Brain impl. */
export interface Session {
  history: unknown[];
}

/** A tool call the brain wants to run but that requires consent first. */
export interface ActionRequest {
  toolUseId: string;
  toolName: string;
  input: unknown;
  createdAt: number;
}

export type AgentOutcome =
  | { kind: 'done'; text: string }
  | { kind: 'consent'; action: ActionRequest };

/**
 * The reasoning "brain" behind an MCP client. Owns all LLM/provider specifics
 * and all conversation-history construction; the runtime treats Session as opaque.
 */
export interface Brain {
  newSession(): Session;
  appendUserText(session: Session, text: string): void;
  appendToolResult(session: Session, toolUseId: string, text: string, isError: boolean): void;
  runTurn(session: Session): Promise<AgentOutcome>;
}
