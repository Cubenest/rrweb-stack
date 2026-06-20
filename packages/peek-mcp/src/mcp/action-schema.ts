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

/**
 * Click a target. Target by `ref` (from get_page_view — deterministic, preferred)
 * OR `selector`; at least one is required (enforced at dispatch, kept optional in
 * the schema so this stays a plain object usable in the discriminated union).
 * Optionally pick nth match (selector only) + which button.
 */
export const ClickActionSchema = z.object({
  type: z.literal('click'),
  ref: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  nth: z.number().int().min(0).optional(),
  button: z.enum(['left', 'middle', 'right']).default('left'),
  // R2: when true, the SW appends a `details.viewDelta` diff after the action lands.
  observe: z.boolean().optional(),
});
export type ClickAction = z.infer<typeof ClickActionSchema>;

/** Type into an input. Target by `ref` or `selector` (one required). `delay` per-char ms. */
export const TypeActionSchema = z.object({
  type: z.literal('type'),
  ref: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  text: z.string(),
  delay: z.number().int().min(0).default(40),
  observe: z.boolean().optional(),
});
export type TypeAction = z.infer<typeof TypeActionSchema>;

/** Top-frame navigation to a URL. */
export const NavigateActionSchema = z.object({
  type: z.literal('navigate'),
  url: z.string().url(),
  observe: z.boolean().optional(),
});
export type NavigateAction = z.infer<typeof NavigateActionSchema>;

/** History.back / forward / location.reload — no DOM target. */
export const BackActionSchema = z.object({
  type: z.literal('back'),
  observe: z.boolean().optional(),
});
export type BackAction = z.infer<typeof BackActionSchema>;

export const ForwardActionSchema = z.object({
  type: z.literal('forward'),
  observe: z.boolean().optional(),
});
export type ForwardAction = z.infer<typeof ForwardActionSchema>;

export const ReloadActionSchema = z.object({
  type: z.literal('reload'),
  observe: z.boolean().optional(),
});
export type ReloadAction = z.infer<typeof ReloadActionSchema>;

/** Scroll: to absolute (x,y), or scrollIntoView on a `ref`/`selector` element. */
export const ScrollActionSchema = z.object({
  type: z.literal('scroll'),
  ref: z.string().min(1).optional(),
  selector: z.string().optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  observe: z.boolean().optional(),
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

/** Press Enter on the active element, or a `ref`/`selector` target (focus → keydown/keypress/keyup). */
export const EnterActionSchema = z.object({
  type: z.literal('enter'),
  ref: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  observe: z.boolean().optional(),
});
export type EnterAction = z.infer<typeof EnterActionSchema>;

/** Double-click a target. Target by `ref` or `selector` (one required). */
export const DblClickActionSchema = z.object({
  type: z.literal('dblclick'),
  ref: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  nth: z.number().int().min(0).optional(),
  observe: z.boolean().optional(),
});
export type DblClickAction = z.infer<typeof DblClickActionSchema>;

/** Agent-set banner string (Part 2). Rides execute_action rails; no DOM target. */
export const SetIntentActionSchema = z.object({
  type: z.literal('set_intent'),
  text: z.string().max(80),
});
export type SetIntentAction = z.infer<typeof SetIntentActionSchema>;

/** Draw a non-destructive highlight overlay on a target, with an optional label. */
export const HighlightActionSchema = z.object({
  type: z.literal('highlight'),
  selector: z.string().min(1),
  label: z.string().max(120).optional(),
});
export type HighlightAction = z.infer<typeof HighlightActionSchema>;

/** Remove the active highlight overlay — no DOM target. */
export const ClearHighlightActionSchema = z.object({
  type: z.literal('clear_highlight'),
});
export type ClearHighlightAction = z.infer<typeof ClearHighlightActionSchema>;

/** Plan B — input handoff. Rides the execute_action rails (wire tool='execute_action'). */
export const RequestUserInputActionSchema = z.object({
  type: z.literal('request_user_input'),
  prompt: z.string().max(280),
  selector: z.string().optional(),
  scope: z.enum(['field', 'page']).default('field'),
  readBack: z.boolean().default(false),
  // This ceiling (10 min) is DOUBLE the bridge's DEFAULT_BRIDGE_TIMEOUT_MS
  // (5 min, host-bridge.ts). server.ts's dispatchActTool now threads
  // timeoutMs = handoffTimeout + 30000 into bridge.request, so the bridge waits
  // with margin above the handoff timer instead of cutting the request off at
  // its 5-min default. The SW controller's timer (clamped to
  // MAX_HANDOFF_TIMEOUT_MS = 240000, action-handler.ts) fires FIRST, so a slow
  // human yields a structured { resumed:false, reason:'timeout' } rather than a
  // transport error.
  timeoutMs: z.number().int().min(0).max(600000).default(120000),
});
export type RequestUserInputAction = z.infer<typeof RequestUserInputActionSchema>;

/**
 * Live page-view snapshot (R1, token-optimization). A non-mutating READ that
 * rides the execute_action rails (wire tool='execute_action'); the SW intercepts
 * it before the gate and auto-allows at per-origin Level 1+. Returns a compact
 * ref-tagged list of interactive/labeled elements in `details` so the agent can
 * target a `ref` instead of authoring a CSS selector. No DOM target itself.
 */
export const PageViewActionSchema = z.object({
  type: z.literal('page_view'),
  selector: z.string().optional(),
  maxElements: z.number().int().min(1).max(500).default(200),
});
export type PageViewAction = z.infer<typeof PageViewActionSchema>;

/**
 * Single-element drill-in (R2). A non-mutating READ that rides the execute_action
 * rails (wire tool='execute_action'); the SW intercepts it before the gate and
 * auto-allows at per-origin Level 1+, reusing the `level-1-read` approver. Resolves
 * a `ref` (from get_page_view) to the FULL masked detail of that one element. No
 * secret in the action itself — just the ref.
 */
export const ElementDetailActionSchema = z.object({
  type: z.literal('element_detail'),
  ref: z.string().min(1),
});
export type ElementDetailAction = z.infer<typeof ElementDetailActionSchema>;

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
  EnterActionSchema,
  DblClickActionSchema,
  HighlightActionSchema,
  ClearHighlightActionSchema,
  SetIntentActionSchema,
  RequestUserInputActionSchema,
  PageViewActionSchema,
  ElementDetailActionSchema,
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
    case 'request_user_input':
      // Record what the AI asked: prompt + selector + scope. `scope` is non-
      // secret and audit-relevant — it distinguishes a page-scope FULL takeover
      // (broader surface) from a field/free-text card in the trail. NEVER the
      // returned value — it lives in the result `details`, which the audit writer
      // never receives (audit.ts buildAuditEntry takes only the action).
      //
      // This intentionally returns a PARTIAL object (drops readBack/timeoutMs),
      // which is why the `as Action` cast is needed — the result is audit-only
      // (consumed solely by buildAuditEntry -> JSON.stringify) and is NOT a
      // dispatchable Action. Do not feed it back into the dispatcher.
      return {
        type: 'request_user_input',
        prompt: action.prompt,
        selector: action.selector,
        scope: action.scope,
      } as Action;
    case 'set_intent':
      // AI-authored status string (not secret); clipped defensively (schema also caps 80).
      return { type: 'set_intent', text: action.text.slice(0, 80) } as Action;
    default:
      return action;
  }
}
