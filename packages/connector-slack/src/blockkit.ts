import type { KnownBlock } from '@slack/types';

/** Mask a value for a consent card: first + last char kept, middle → fixed
 *  3-char bullet run; length ≤ 2 masks wholly. Byte-identical contract to
 *  peek-mcp's maskValue (the packages don't share a util). */
export function maskValue(value: string): string {
  if (value.length <= 2) return '•••';
  return `${value[0]}•••${value[value.length - 1]}`;
}

const APPROVE_BUTTON_VALUE = (correlationId: string, conversationId: string): string =>
  JSON.stringify({ correlationId, conversationId });

function isActionDetails(details: unknown): details is Record<string, unknown> & { type: string } {
  return (
    typeof details === 'object' &&
    details !== null &&
    typeof (details as { type?: unknown }).type === 'string'
  );
}

const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asNum = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const targetOf = (d: Record<string, unknown>): string => {
  const base = asStr(d.ref) ?? asStr(d.selector) ?? '(active element)';
  const nth = asNum(d.nth);
  return nth !== undefined ? `\`${base}\` #${nth}` : `\`${base}\``;
};

/** One-line human sentence for a suspend-path Action `details` payload. Masks
 *  any literal value that would persist in Slack history. */
export function humanizeAction(action: Record<string, unknown>): string {
  const t = asStr(action.type);
  switch (t) {
    case 'click':
      return `Click ${targetOf(action)}`;
    case 'dblclick':
      return `Double-click ${targetOf(action)}`;
    case 'type':
      return `Type "${maskValue(asStr(action.text) ?? '')}" into ${targetOf(action)}`;
    case 'enter':
      return `Press Enter on ${targetOf(action)}`;
    case 'navigate':
      return `Navigate to ${asStr(action.url) ?? '(url)'}`;
    case 'back':
      return 'Go back';
    case 'forward':
      return 'Go forward';
    case 'reload':
      return 'Reload the page';
    case 'scroll':
      return action.ref !== undefined || action.selector !== undefined
        ? `Scroll ${targetOf(action)} into view`
        : 'Scroll the page';
    case 'screenshot':
      return 'Take a screenshot';
    case 'waitFor':
      return action.selector !== undefined ? `Wait for ${targetOf(action)}` : 'Wait';
    case 'highlight':
      return `Highlight ${targetOf(action)}`;
    case 'clear_highlight':
      return 'Clear the highlight';
    case 'set_intent':
      return 'Set the intent banner';
    case 'request_user_input':
      return `Ask you: "${maskValue(asStr(action.prompt) ?? '')}"`;
    default:
      return `Run "${t ?? 'action'}"`;
  }
}

/** Structured fields for the suspend-path card — only keys present + non-default.
 *  Masks text/prompt values. */
function actionFields(action: Record<string, unknown>): string[] {
  const fields: string[] = [];
  const ref = asStr(action.ref);
  const selector = asStr(action.selector);
  const nth = asNum(action.nth);
  if (ref !== undefined) fields.push(`*Target:* \`${ref}\``);
  else if (selector !== undefined) fields.push(`*Target:* \`${selector}\``);
  if (nth !== undefined) fields.push(`*Nth:* ${nth}`);
  const url = asStr(action.url);
  if (url !== undefined) fields.push(`*URL:* ${url}`);
  const text = asStr(action.text);
  if (text !== undefined) fields.push(`*Text:* "${maskValue(text)}"`);
  const prompt = asStr(action.prompt);
  if (prompt !== undefined) fields.push(`*Prompt:* "${maskValue(prompt)}"`);
  if (action.observe === true) fields.push('*Observe:* yes');
  return fields;
}

export function consentCard(
  summary: string,
  details: unknown,
  correlationId: string,
  conversationId: string,
): { blocks: KnownBlock[] } {
  const value = APPROVE_BUTTON_VALUE(correlationId, conversationId);
  const header: KnownBlock = {
    type: 'header',
    text: { type: 'plain_text', text: 'peek wants to act on your browser' },
  };
  const context: KnownBlock = {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Action ${correlationId}` }],
  };
  const buttons: KnownBlock = {
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Approve' },
        style: 'primary',
        action_id: 'peek_approve',
        value,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Deny' },
        style: 'danger',
        action_id: 'peek_deny',
        value,
      },
    ],
  };

  const bodyBlocks: KnownBlock[] = [];
  if (isActionDetails(details)) {
    // Suspend path: classified Action → humanized sentence + fields.
    bodyBlocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${humanizeAction(details)}*` },
    });
    const fields = actionFields(details);
    if (fields.length > 0) {
      bodyBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: fields.join('\n') } });
    }
  } else if (
    details !== undefined &&
    details !== null &&
    Object.keys(details as object).length > 0
  ) {
    // Unclassifiable non-empty details → raw JSON code-block fallback (truncated).
    const json = JSON.stringify(details, null, 2);
    const MAX_DETAILS = 2800;
    const shown = json.length > MAX_DETAILS ? `${json.slice(0, MAX_DETAILS)}\n… (truncated)` : json;
    bodyBlocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${summary}*\n\`\`\`${shown}\`\`\`` },
    });
  } else {
    // Delegated path: details is {} — summary is already a masked human sentence.
    bodyBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: summary } });
  }

  return { blocks: [header, ...bodyBlocks, context, buttons] };
}

export function textBlocks(text: string): KnownBlock[] {
  return [{ type: 'section', text: { type: 'mrkdwn', text } }];
}

export function confirmation(text: string): KnownBlock[] {
  return [{ type: 'section', text: { type: 'mrkdwn', text: `✅ ${text}` } }];
}
