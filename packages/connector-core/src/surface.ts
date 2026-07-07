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
}
