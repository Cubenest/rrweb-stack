export interface InboundMessage {
  conversationId: string;
  userId: string;
  text: string;
}

export interface ConsentRequest {
  correlationId: string;
  summary: string;
  details: unknown;
}

export interface ConsentResponse {
  conversationId: string;
  correlationId: string;
  decision: 'approve' | 'deny';
}

export interface SurfaceAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (m: InboundMessage) => void): void;
  onConsentResponse(handler: (r: ConsentResponse) => void): void;
  postText(conversationId: string, text: string): Promise<void>;
  postConsentRequest(conversationId: string, req: ConsentRequest): Promise<void>;
  postConfirmation(conversationId: string, text: string): Promise<void>;
  /** Optional: post a classified, legible error. Runtime null-checks it, so an
   *  adapter that doesn't implement it degrades to postText. */
  postError?(
    conversationId: string,
    err: { kind: string; headline: string; hint: string },
  ): Promise<void>;
  /** Optional: upload a local file to the surface (e.g. post a .peekbundle to a Slack channel).
   *  Adapters that do not support file uploads may omit this method; the runtime degrades to a
   *  text note so no crash occurs. The runtime calls this during share_session interception and
   *  always deletes the temp file (try/finally) regardless of upload success or failure. */
  postFile?(
    conversationId: string,
    filePath: string,
    filename: string,
    comment?: string,
  ): Promise<void>;
}
