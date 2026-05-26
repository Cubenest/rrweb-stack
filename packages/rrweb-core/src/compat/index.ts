// Compatibility matrix — Task 1.11.
//
// Locked surface per IMPLEMENTATION_PLAN.md Public API contract (line
// 732):
//
//   export { COMPATIBILITY_MATRIX, type CompatEntry } from './compat';
//
// One frozen array of entries + one entry type. The TypeScript source
// is authoritative; `packages/rrweb-core/COMPATIBILITY.md` mirrors it
// for human readers and a drift-free test guards both stay in sync.
//
// ADR-0002: "A published list of target applications that are known to
// record cleanly, record with caveats, or record poorly. Both products
// inherit rrweb's limits; both products inherit the matrix. Updating it
// once benefits both."

/**
 * A single entry in the compatibility matrix. Documents how
 * rrweb-based capture behaves on a specific target application or
 * page kind.
 *
 * Sources: PostHog's session-replay compatibility docs
 * (https://posthog.com/docs/session-replay/troubleshooting),
 * rrweb-io issue tracker, and our own first-party observations as
 * they accumulate. Updates go via a Changesets PR.
 */
export interface CompatEntry {
  /**
   * Identifying URL or pattern. Doesn't need to be a real URL — can
   * be a category like 'youtube.com' or 'github.com/*'.
   */
  readonly url: string;
  /** Coarse category — pick the most representative. */
  readonly category:
    | 'developer-tools' // GitHub, Linear, Notion, PostHog itself
    | 'spa-framework' // React/Vue/Svelte app shells
    | 'rich-text-editor' // Notion, Slate, Lexical, Quill
    | 'video-streaming' // YouTube, Vimeo, Twitch
    | 'canvas-webgl' // Figma, Miro, Excalidraw, Three.js demos
    | 'chat-messaging' // Slack, Discord, web messaging
    | 'email-webmail' // Gmail, Outlook web
    | 'docs-collaboration' // Google Docs, Notion docs
    | 'social-feed' // Twitter/X, Reddit, LinkedIn
    | 'commerce' // Shopify storefronts, Amazon
    | 'auth-flow' // OAuth provider screens
    | 'iframe-heavy' // Sites that embed many cross-origin iframes
    | 'pdf-viewer' // Native browser PDF or pdf.js
    | 'other';
  /** Coarse status — set by the maintainer based on the latest evidence. */
  readonly status: 'good' | 'caveats' | 'poor';
  /**
   * Short, factual description of what works / doesn't / mitigations.
   * Keep < 240 chars per entry.
   */
  readonly notes: string;
  /** Last verified date (YYYY-MM-DD). */
  readonly lastVerified: string;
}

/**
 * Seed entries — 5 known-good, 5 known-caveats/poor. Sourced from
 * PostHog's published session-replay docs and the rrweb-io issue
 * tracker. Each entry is defensible against external documentation;
 * future updates go through Changesets PRs with a link to the
 * supporting evidence.
 */
export const COMPATIBILITY_MATRIX: readonly CompatEntry[] = Object.freeze([
  // ─── Good (records cleanly) ───────────────────────────────────────
  Object.freeze({
    url: 'posthog.com',
    category: 'developer-tools',
    status: 'good',
    notes:
      'Recorded by PostHog themselves in production; canonical baseline for the fork. DOM-only, no canvas, no closed shadow roots in critical paths.',
    lastVerified: '2026-05-26',
  }),
  Object.freeze({
    url: 'github.com',
    category: 'developer-tools',
    status: 'good',
    notes:
      'DOM-heavy SPA, no embedded canvas/WebGL; recording captures full session including code-review UIs and PR diff views.',
    lastVerified: '2026-05-26',
  }),
  Object.freeze({
    url: 'cypress.io',
    category: 'developer-tools',
    status: 'good',
    notes: 'Static marketing pages + dashboards; clean capture, no special handling required.',
    lastVerified: '2026-05-26',
  }),
  Object.freeze({
    url: 'vercel.com',
    category: 'developer-tools',
    status: 'good',
    notes:
      'Dashboard SPA; Next.js + RSC; clean capture, streaming HTML islands settle predictably.',
    lastVerified: '2026-05-26',
  }),
  Object.freeze({
    url: 'linear.app',
    category: 'spa-framework',
    status: 'good',
    notes:
      "Heavy React SPA with high mutation rates; rrweb's mutation guard (10k cap) recommended to bound replay size.",
    lastVerified: '2026-05-26',
  }),
  // ─── Caveats / poor (records with limits) ─────────────────────────
  Object.freeze({
    url: 'figma.com',
    category: 'canvas-webgl',
    status: 'poor',
    notes:
      'Canvas-based editor; rrweb sees the parent DOM but not the canvas contents. Use screenshot fallback for the canvas region.',
    lastVerified: '2026-05-26',
  }),
  Object.freeze({
    url: 'youtube.com',
    category: 'video-streaming',
    status: 'caveats',
    notes:
      '<video> tags record but media playback is not part of the snapshot; replay shows poster frames + UI mutations only.',
    lastVerified: '2026-05-26',
  }),
  Object.freeze({
    url: 'gmail.com',
    category: 'email-webmail',
    status: 'caveats',
    notes:
      'Heavy custom elements + shadow DOM; closed shadow roots in MAIN world are unreachable. ISOLATED-world relay via chrome.dom.openOrClosedShadowRoot (peek path) closes the gap.',
    lastVerified: '2026-05-26',
  }),
  Object.freeze({
    url: 'notion.so',
    category: 'rich-text-editor',
    status: 'caveats',
    notes:
      'Slate-based editor with high mutation rates; rely on the mutation guard (10k cap) to avoid runaway recordings.',
    lastVerified: '2026-05-26',
  }),
  Object.freeze({
    url: 'docs.google.com',
    category: 'docs-collaboration',
    status: 'poor',
    notes:
      'Custom rendering layer (not real DOM text nodes); rrweb captures empty containers. Use screenshot fallback for content. Selection state not recoverable.',
    lastVerified: '2026-05-26',
  }),
]);
