import type { KnownBlock } from '@slack/types';

export function textBlocks(text: string): KnownBlock[] {
  return [{ type: 'section', text: { type: 'mrkdwn', text } }];
}

export function consentCard(
  summary: string,
  details: unknown,
  correlationId: string,
  conversationId: string,
): { blocks: KnownBlock[] } {
  const value = JSON.stringify({ correlationId, conversationId });
  const json = JSON.stringify(details, null, 2);
  const MAX_DETAILS = 2800;
  const shown = json.length > MAX_DETAILS ? `${json.slice(0, MAX_DETAILS)}\n… (truncated)` : json;
  const body = `*${summary}*\n\`\`\`${shown}\`\`\``;
  return {
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: body } },
      {
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
      },
    ],
  };
}

export function confirmation(text: string): KnownBlock[] {
  return [{ type: 'section', text: { type: 'mrkdwn', text: `✅ ${text}` } }];
}
