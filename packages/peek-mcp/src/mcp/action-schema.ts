// Action zod schemas (P2 PRD §E.4) used by the two Level-3+ MCP write tools
// (Task 3.24): `execute_action` validates `Action`, and `request_authorization`
// accepts the same shape so the side panel banner can describe what it's about
// to do.
//
// Discriminated union on `type` — the SDK auto-converts zod to JSON Schema for
// MCP tool listings, and clients send back a tagged object the host routes to
// the MAIN-world dispatcher.
//
// Keep this in sync with the dispatcher in
// `packages/peek-extension/src/permissions/dispatcher.ts`. New `type`s land
// here first (the source of truth for tool inputSchema), then the dispatcher
// grows a matching case.

import { z } from 'zod';

/** Click on a selector. Optionally pick nth match + which button. */
export const ClickActionSchema = z.object({
  type: z.literal('click'),
  selector: z.string().min(1),
  nth: z.number().int().min(0).optional(),
  button: z.enum(['left', 'middle', 'right']).default('left'),
});
export type ClickAction = z.infer<typeof ClickActionSchema>;

/** Type into an input. `delay` is per-character in ms. */
export const TypeActionSchema = z.object({
  type: z.literal('type'),
  selector: z.string().min(1),
  text: z.string(),
  delay: z.number().int().min(0).default(40),
});
export type TypeAction = z.infer<typeof TypeActionSchema>;

/** Top-frame navigation to a URL. */
export const NavigateActionSchema = z.object({
  type: z.literal('navigate'),
  url: z.string().url(),
});
export type NavigateAction = z.infer<typeof NavigateActionSchema>;

/** History.back / forward / location.reload — no DOM target. */
export const BackActionSchema = z.object({ type: z.literal('back') });
export type BackAction = z.infer<typeof BackActionSchema>;

export const ForwardActionSchema = z.object({ type: z.literal('forward') });
export type ForwardAction = z.infer<typeof ForwardActionSchema>;

export const ReloadActionSchema = z.object({ type: z.literal('reload') });
export type ReloadAction = z.infer<typeof ReloadActionSchema>;

/** Scroll: either to absolute (x,y) or scrollIntoView on the selected element. */
export const ScrollActionSchema = z.object({
  type: z.literal('scroll'),
  selector: z.string().optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
});
export type ScrollAction = z.infer<typeof ScrollActionSchema>;

/** chrome.tabs.captureVisibleTab — non-mutating, but still a Level-3+ tool. */
export const ScreenshotActionSchema = z.object({
  type: z.literal('screenshot'),
  selector: z.string().optional(),
});
export type ScreenshotAction = z.infer<typeof ScreenshotActionSchema>;

/** Wait for a selector to appear or timeoutMs to elapse, whichever first. */
export const WaitForActionSchema = z.object({
  type: z.literal('waitFor'),
  selector: z.string().optional(),
  timeoutMs: z.number().int().min(0).default(5000),
});
export type WaitForAction = z.infer<typeof WaitForActionSchema>;

/** The full Action discriminated union (P2 PRD §E.4). */
export const ActionSchema = z.discriminatedUnion('type', [
  ClickActionSchema,
  TypeActionSchema,
  NavigateActionSchema,
  BackActionSchema,
  ForwardActionSchema,
  ReloadActionSchema,
  ScrollActionSchema,
  ScreenshotActionSchema,
  WaitForActionSchema,
]);
export type Action = z.infer<typeof ActionSchema>;

/**
 * Mask the action's sensitive fields for audit-log persistence. `type`
 * `text` (TypeAction) and `url` query strings can carry passwords / tokens.
 * We don't have access to the masking primitives via z's own pipeline, so
 * this is a small explicit helper. Lossy by design.
 */
export function redactActionForAudit(action: Action): Action {
  switch (action.type) {
    case 'type':
      // Replace the typed text with a token marker so the audit log records
      // that a TypeAction happened on selector X without preserving the value.
      return { ...action, text: '<<REDACTED>>' };
    case 'navigate': {
      // Strip query-string values (params keep their names, see mask.ts).
      try {
        const u = new URL(action.url);
        for (const key of [...u.searchParams.keys()]) {
          u.searchParams.set(key, '<<REDACTED>>');
        }
        return { ...action, url: u.href };
      } catch {
        return action;
      }
    }
    default:
      return action;
  }
}
