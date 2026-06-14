import type { DispatchTarget } from '../permissions/action-handler';
import type { Action } from '../permissions/action-protocol';

export const STANDING_BY = 'peek is controlling this page — standing by';

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Human-readable banner label for the action peek is currently dispatching.
 * Secret-omission: never echoes `type` text; `navigate` is host-only; click
 * text is clipped (page text is adversary-controllable and on-screen/aria-live).
 * Pass `null` for the idle/standing-by default.
 */
export function describeAction(action: Action | null, target: DispatchTarget): string {
  if (action === null) return STANDING_BY;
  switch (action.type) {
    case 'click': {
      const raw = target.text ?? target.ariaLabel ?? action.selector ?? 'element';
      return `Clicking '${clip(raw, 60)}'`;
    }
    case 'type': {
      const where = target.ariaLabel ?? `the ${action.selector ?? ''} field`.trim();
      return `Typing into ${where}`;
    }
    case 'navigate': {
      let host: string;
      try {
        host = new URL(action.url).host;
      } catch {
        host = 'a new page';
      }
      return `Navigating to ${host}`;
    }
    case 'scroll':
      return 'Scrolling the page';
    case 'back':
      return 'Going back';
    case 'forward':
      return 'Going forward';
    case 'reload':
      return 'Reloading the page';
    default:
      return STANDING_BY;
  }
}
