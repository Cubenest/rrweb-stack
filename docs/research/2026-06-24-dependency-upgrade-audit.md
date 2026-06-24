# Dependency upgrade audit — 2026-06-24

A grounded, adversarially-verified audit of every outdated dependency across the
monorepo (`pnpm outdated -r` → 36 deps: 17 major, 14 minor, 7 patch), clustered
by upgrade decision, with breaking-change research checked against official
migration guides and this repo's actual consumers/peer constraints.

**Status:** Tier A + Tier C (the safe minor/patch batch) executed in the PR that
adds this doc. Everything else is a tracked recommendation.

## The load-bearing fact: the cross-major toolchain pin

The repo deliberately holds **vitest at v2**. The two `pnpm.overrides`
(`vite-node ^3.2.4`, `@vitejs/plugin-react ^5.0.4`) are a **bridge** that lifts
vitest-2's runtime onto the vite-6 line WXT 0.20 (peek-extension) needs, while
plugin-react 5.2's universal vite peer (`^4||^5||^6||^7||^8`) lets one plugin
version span both the vite-6 (extension) and vite-8 (todomvc-demo) lines.
Removing these overrides is **only** coherent as a coordinated vite-8 + vitest-4
migration — never a standalone bump. (Verified: vitest 4 runs on Node 22 and
needs vite ≥6, already satisfied; the coordinated move also raises root
`engines` to `>=22.12.0`, still Node 22, no better-sqlite3 impact.)

## Prioritized board

### 🟢 Tier A — safe-now batch (executed here)
`lefthook 1→2.1.9`, `cross-env 7→10`, `js-yaml 4→5`, `better-sqlite3 12.10→12.11.1`
(⚠️ 12.11.0 is unpublished/404 — target .1; Node-22 prebuilds intact), `sharp 0.34→0.35`,
`wxt 0.20.27`, `tsx 4.22.4`, `@webext-core/fake-browser 1.5.2`, `esbuild 0.28.1`,
`@types/chrome 0.1→0.2`. Verified: typecheck + tests green.

### 🟢 Tier C — low-risk minor batch (executed here)
`@wdio/* + webdriverio 9.27→9.29`, `@playwright/test + playwright 1.60→1.61`,
`framer-motion 12.41`, `lucide-react 1.21`. Pure minors.

### 🟢 Tier B — TypeScript 6 + Biome 2 (next; contained churn)
- **TS 6** (5.9→6.0): one real hit — peek-extension throws ~98 chrome-type errors
  from TS6's new `types:[]` + `noUncheckedSideEffectImports` defaults → fix = add
  `types:["chrome"]`. Edits 3 tsconfigs (root + 2 docs apps pin their own TS).
- **Biome 2** (1.9→2.5): `biome migrate`; v2 **now lints HTML** (new); ~7 residual
  hand-fixes after autofix (`type=` on 4 `<button>`s, `useTemplate` ×12).

### 🟡 Tier D — React 19 in peek-extension (contained major)
`react`/`react-dom`/`@types/react(-dom)` 18→19 (todomvc-demo already on 19). WXT
allows it; **independent of the toolchain migration** (plugin-react 5 supports React 19).

### 🟡 Tier E — rrweb-player 2 (contained, medium)
`1.0.0-alpha.4 → 2.0.1`. `dist/index.js` was renamed — fix `assets.ts` to use the
proper 2.0.1 export (NOT `readUmdViaUnpkg`), re-check the UMD `rrwebPlayer` global
in `assets.test.ts`. 21-day supply-chain hold cleared.

### 🟠 Tier F — coordinated toolchain migration (schedule; high-leverage, low-urgency)
**vite 8 + vitest 4 + plugin-react 6**, one PR: remove both overrides, raise
`engines` to `>=22.12.0`, re-validate the **15** `vi.mock`/`vi.spyOn` files,
confirm Vitest-4's simplified default-`exclude` catches no package, smoke-test
both Astro docs builds + the WXT recorder IIFE.

### 🔴 Tier G — hold / decision-required
| Item | Why hold |
|---|---|
| `zod 3→4` | Risk scoped to **peek-mcp internal schemas**; couples with Astro 6 (bundles zod 4) — bump `docs-shared`'s own zod standalone first |
| `astro 5→7` | Two majors, docs sites; couples zod 4 + Node 22.12 + **manual redeploy**; v6/v7 behavioral checks (heading-anchor IDs, `compressHTML` default→jsx) |
| `@posthog/rrweb 0.0.34→0.0.60` | **ADR-0002 deliberately freezes** the masking substrate at 0.0.34. Supply-chain clear (0.0.60 ~61 days old, past the 21-day hold), but unfreezing is an explicit ADR decision. `@posthog/rrweb-types` deprecation is **pre-existing** + can't be removed (engine depends on it) |
| `jsdom 25→29` | Node floor 22.13 (CI is Node 24 ✅); declared in 4 packages — batch with care |
| `@types/node 24→26` | **Skip** — track Node 22 types, don't chase 26 |

## Recommended sequence
**A + C** (here) → **B** (TS6 + Biome2) → **D** (React 19) → **E** (rrweb-player)
→ **F** (toolchain, scheduled) → **G** decisions (zod + astro together;
rrweb-substrate per ADR-0002; jsdom alongside F).

## Verified corrections (from the adversarial pass)
- vitest re-validation surface is **15** files, not 19; Vitest-4 default-`exclude`
  simplification is inert here (tests live in `test/`, never compiled into `dist`) — confirm at PR time.
- TS6 peek-extension breakage is ~98 chrome errors from `types:[]` **and**
  `noUncheckedSideEffectImports`.
- Biome 2 newly lints `.html`.
- rrweb-player fix is the proper 2.0.1 export, not the unpkg helper.
- jsdom 29 engines: `^20.19 || ^22.13 || >=24`; CI Node 24 clears it.
- better-sqlite3 12.11.0 is unpublished (404) — caret can't land it; target 12.11.1.

## Notes
- Renovate (`config:best-practices`, 7-day cooldown) auto-merges patches; minors/majors
  get PRs but are not auto-merged. The rrweb lineage is held 21 days, no auto-merge
  (PostHog "Shai-Hulud 2.0" supply-chain incident, Nov 2025).
- A pre-existing parallel-execution flake exists in `peek-mcp/test/host-socket.test.ts`
  (temp-dir `EISDIR` race under `pnpm -r test`; passes deterministically in isolation) —
  unrelated to any dependency bump.
