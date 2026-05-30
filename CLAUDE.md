# Project context for AI coding assistants

This file is the project's vendor-neutral instructions doc for AI tools (Claude
Code, Cursor, Cline, Aider, Continue, Codex CLI — anything that reads
`CLAUDE.md` / `AGENTS.md` / equivalent). It documents two things every
AI-assisted session should know before making changes: **what the repo is** and
**where the planning context lives**.

## What the repo is

`Cubenest/rrweb-stack` is a monorepo that publishes two independent products
on a shared substrate:

- **tracelane** (npm scope `@tracelane`) — failed-test recorder for
  end-to-end suites (WebdriverIO today, Playwright + Cypress on the roadmap).
  Captures rrweb session + console + failed-network responses, ships a
  self-contained HTML report on failure. Apache-2.0.
- **peek** (npm scope `@peekdev`) — browser companion for AI coding agents.
  Records masked browser sessions to a local SQLite store via a native host
  and exposes them to coding agents through an MCP server. Apache-2.0.
- **@cubenest/rrweb-core** — the shared rrweb fork used by both products
  (PostHog's fork + a framework-agnostic network plugin).

Both products are pre-1.0 alpha, side-project–maintained, no paid
infrastructure, no telemetry, no cloud. See `docs/SUSTAINABILITY.md` for the
maintenance posture and `docs/SECURITY-NOTES.md` for the threat model.

The build is pnpm + Turbo + Changesets. WXT 0.20 for the Chrome MV3
extension. Vitest 2 (cross-major-pinned via root override). Astro for the two
docs sites. Lefthook for pre-commit lint (biome + custom checks).

## Planning context — the `_context/` convention

There is a **maintainer-private companion repo** at
[`Cubenest/rrweb-stack-private`](https://github.com/Cubenest/rrweb-stack-private)
that holds the planning + design context:

```
_context/
  prds/
    adrs/                   # 12 Architecture Decision Records
    IMPLEMENTATION_PLAN.md  # task-by-task plan referenced by CHANGELOG entries
    NAMING.md               # name verification gates
    p1-prd-tracelane.md     # full P1 PRD
    p2-prd-peek.md          # full P2 PRD
    shared-preamble.md      # project thesis + side-project posture
  docs/
    PHASE_5_LAUNCH_PLAN.md  # 90-day launch motion + risk register
    posts/                  # blog drafts
    research/               # synthesized research briefs
```

The companion repo is **not a submodule** and is **not cloned by CI**. It's
mapped into a maintainer's local checkout via a symlink that's gitignored:

```sh
# Maintainer-only setup (do this once per fresh checkout):
cd ..                                                       # parent of rrweb-stack/
git clone git@github.com:Cubenest/rrweb-stack-private.git
cd rrweb-stack
ln -s ../rrweb-stack-private _context
```

After that, `_context/` resolves to the private repo's tree. Reading
`_context/prds/adrs/0001-two-products-one-substrate.md` works exactly as if
the ADR lived in this repo.

### How AI tools should use `_context/`

**If `_context/` resolves** (maintainer's machine, both repos cloned):

- Before proposing scope changes, architecture decisions, or new packages,
  read `_context/prds/adrs/` to check whether an ADR already covers it.
- Before making release / launch / outreach suggestions, read
  `_context/docs/PHASE_5_LAUNCH_PLAN.md` — the maintainer has a falsifiable
  90-day plan and a documented anti-pattern floor that proposed work should
  not violate.
- Task IDs in CHANGELOG entries (e.g., "Task 3.22 — five-level permission
  model") resolve to `_context/prds/IMPLEMENTATION_PLAN.md`.
- The two PRDs (`_context/prds/p1-prd-tracelane.md`,
  `_context/prds/p2-prd-peek.md`) are the spec for what each product is
  trying to be.

**If `_context/` is absent** (CI runner, contributor without access, fresh
clone before the symlink is created):

- The directory will appear as a broken symlink or not exist at all. Don't
  treat that as an error — proceed using only the public repo's contents.
- Public ADR rationale that's load-bearing for understanding the code is
  summarized inline in package READMEs and `docs/SECURITY-NOTES.md`.

### What's NOT in `_context/`

- Anything a contributor needs to submit a PR (`CONTRIBUTING.md`,
  `SECURITY.md`, threat model, security notes — all public).
- Maintenance / SLA disclosure (`docs/SUSTAINABILITY.md` is public).
- Privacy policy + permission justifications (public, required for the
  Chrome Web Store).
- API docs (live next to the code).

## Project conventions

- **Direct-to-main commits** authorized for the maintainer. Branch
  protection is deferred until post-1.0 (see Phase 4 in the implementation
  plan).
- **DCO sign-off mandatory** on every commit (`git commit -s …`). Lefthook
  enforces this.
- **Conventional commit prefixes** preferred but not enforced. Common
  prefixes used in history: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `test:`, `release:`.
- **Changesets** drive version bumps. `pre-mode` is active (tag: `alpha`).
  Every user-visible change in a published package needs a changeset file.
- **`packages/peek-extension/chrome-mv3/`** is a hand-maintained copy of the
  WXT build output for chrome://extensions loads. It's gitignored. Don't
  edit it directly — rebuild via `pnpm --filter @peekdev/extension build`.
- **Never use `--no-verify`** to skip pre-commit hooks. Fix the root cause.

## Memory

Multi-turn AI tools (Claude Code's auto-memory, Cursor's memories) should
remember:

- The `_context/` convention (this doc).
- That historical CHANGELOG and `.changeset/*.md` entries are **frozen
  records** — never rewrite them, even when the referenced links go stale.
- That commit `10c135d` (the post-history-rewrite root of the audit
  cleanup) scrubbed PII + internal-strategy content from public history.
  Pre-rewrite SHAs from earlier in the session are gone. The scrubbed
  content lives in `_context/` now; public history won't show it.
- That the maintainer uses the `harry-harish` GitHub account
  (noreply email `22562634+harry-harish@users.noreply.github.com`) for all
  Cubenest org work, separate from any other accounts on the same machine.
