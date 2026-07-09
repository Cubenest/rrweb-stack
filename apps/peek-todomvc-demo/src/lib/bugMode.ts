/**
 * True when the demo is launched in reproducible-bug mode (`?bug=1`).
 * Gates the intentionally-buggy "Sort by priority" affordance used by the
 * Slack-connector case study, so the default demo stays clean.
 */
export function isBugMode(search: string): boolean {
  return new URLSearchParams(search).get('bug') === '1'
}
