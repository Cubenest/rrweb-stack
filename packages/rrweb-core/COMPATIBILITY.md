# Compatibility matrix

This document mirrors `COMPATIBILITY_MATRIX` exported from
`@cubenest/rrweb-core`. The TypeScript source
(`src/compat/index.ts`) is authoritative; this file is regenerated
manually for the v0.1 alpha and a drift-free test (`test/compat.test.ts`)
guards the two stay in sync. Last sync: 2026-05-26.

## Status legend

- **good** — records cleanly with no special handling required.
- **caveats** — records, but with known limitations. Read the notes
  before relying on the capture for debugging.
- **poor** — captures the DOM scaffolding but misses the meaningful
  content (e.g. canvas pixels, custom rendering layers). Pair with a
  screenshot fallback.

## Matrix

| URL | Category | Status | Notes |
|---|---|---|---|
| posthog.com | developer-tools | good | Recorded by PostHog themselves in production; canonical baseline for the fork. DOM-only, no canvas, no closed shadow roots in critical paths. |
| github.com | developer-tools | good | DOM-heavy SPA, no embedded canvas/WebGL; recording captures full session including code-review UIs and PR diff views. |
| cypress.io | developer-tools | good | Static marketing pages + dashboards; clean capture, no special handling required. |
| vercel.com | developer-tools | good | Dashboard SPA; Next.js + RSC; clean capture, streaming HTML islands settle predictably. |
| linear.app | spa-framework | good | Heavy React SPA with high mutation rates; rrweb's mutation guard (10k cap) recommended to bound replay size. |
| figma.com | canvas-webgl | poor | Canvas-based editor; rrweb sees the parent DOM but not the canvas contents. Use screenshot fallback for the canvas region. |
| youtube.com | video-streaming | caveats | `<video>` tags record but media playback is not part of the snapshot; replay shows poster frames + UI mutations only. |
| gmail.com | email-webmail | caveats | Heavy custom elements + shadow DOM; closed shadow roots in MAIN world are unreachable. ISOLATED-world relay via chrome.dom.openOrClosedShadowRoot (peek path) closes the gap. |
| notion.so | rich-text-editor | caveats | Slate-based editor with high mutation rates; rely on the mutation guard (10k cap) to avoid runaway recordings. |
| docs.google.com | docs-collaboration | poor | Custom rendering layer (not real DOM text nodes); rrweb captures empty containers. Use screenshot fallback for content. Selection state not recoverable. |

## Sources

- [PostHog session-replay troubleshooting docs](https://posthog.com/docs/session-replay/troubleshooting)
- [rrweb-io issue tracker](https://github.com/rrweb-io/rrweb/issues)
- First-party observations from `@cubenest/rrweb-core` integration runs.

## Reporting drift

If you observe behavior different from this matrix, please open an
issue with reproduction steps (browser + version, URL, what you saw vs
what the matrix claims). Updates flow through a Changesets PR that
touches both `src/compat/index.ts` and this file; the drift-free test
will fail if only one is changed.
