// Text-node content masking.

import { applyRegexBank } from './regex.js';

/**
 * Apply the PII regex bank to a text-node's content. Used when capturing
 * text mutations during recording.
 *
 * Pure string in, pure string out — no DOM dependency. Callers extract
 * `textNode.data` (or equivalent) before calling.
 */
export function maskTextContent(text: string): string {
  if (text.length === 0) return text;
  return applyRegexBank(text);
}
