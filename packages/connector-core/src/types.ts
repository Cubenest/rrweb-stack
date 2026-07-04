import type { ActionRequest } from './brain.js';

export type ToolKind = 'read' | 'action';

/** Runtime-owned: an ActionRequest awaiting consent, tagged with the correlationId. */
export interface PendingRecord extends ActionRequest {
  correlationId: string;
}
