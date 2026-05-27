// Small HTML/JSON escaping helpers for safe report composition.
//
// Two distinct hazards are handled:
//   1. User/test metadata rendered as HTML text (titles, errors, console
//      messages) must be HTML-escaped so a `<` in an error message can't inject
//      markup — see {@link escapeHtml}.
//   2. JSON embedded inside an inline `<script>` must have its `</` sequences
//      neutralised so a `</script>` inside string data can't terminate the
//      script element early (the classic inline-JSON XSS) — see
//      {@link serializeForScript}.

/** HTML-escape a string for safe interpolation into element text / attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialize a value to JSON safe to embed inside an inline `<script>`. Escapes
 * `<` (covers `</script>` and `<!--`) and the U+2028/U+2029 line terminators
 * that are illegal in JS string literals. The result is valid JSON that direct
 * JS evaluation (or `JSON.parse`) reads back intact.
 */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
