## Phase 5 Launch Plan — tracelane + peek

> Living document. Last updated 2026-05-29. Owner: harry-harish.
> Status: drafted post-Phase-4c sign-off (Ship verdict, both products). Pre-public-push.
> Supersedes the earlier ~300-line strategy at `../../docs/tracelence-peek-dev-distribution.md` (kept for git-blame continuity; do not edit).

This document turns four pieces of deep research — integration-led distribution, non-integration distribution, ethical growth, and the OSS maintenance field manual — into an executable 90-day plan per product, plus a risk register, plus an explicit floor of things not to do. It is written for the solo maintainer (`harry-harish`) as the operator, with the explicit constraint that this is a side project run alongside a Capillary Tech day job. Every section is meant to be edited as facts change; the value of the doc is in being concrete enough that "what changed?" is answerable.

---

### TL;DR

- The integration-led thesis is validated but conditional: ship the WDIO / Playwright-reporter / Allure-attach wedges for `tracelane` and the MCP / Claude-Skill / CWS / Cursor-directory wedges for `peek`. Anything else is a community PR, not initiated work.
- Hard cap at 5 active integrations per product. The Storybook-addon catalog (200+ addons, ~5 with real traction) and `@wdio/*` reporter long-tail both prove that listing without default-status is decoration, not distribution.
- Three explicit anti-targets: Cypress full Test Replay overlap (host competes), Sentry Session Replay attach for `tracelane` (production vs test-time category confusion), Highlight.io for `peek` (dead by Feb 28 2026).
- Pre-launch gating is supply-chain hygiene first, first-impression artifacts second. The `@posthog/rrweb` substrate is the single highest-impact supply-chain risk we own; the maintenance manual's controls are non-optional.
- Day-90 falsifiable thresholds: `@tracelane/wdio` ≥ 1k weekly DLs, `@tracelane/playwright-reporter` ≥ 2.5k weekly DLs, `@tracelane/allure-attachment` ≥ 500 weekly DLs, `@peekdev/mcp` listed on PulseMCP with ≥ 50k cumulative "Est. Visitors", CWS ≥ 500 WAU, recipes in ≥ 3 awesome-claude-skills lists. Miss any of these → re-evaluate positioning, not channel.

---

### 1. Strategic framing

#### 1.1 The four research docs in one paragraph each

**Integration-led distribution (the earlier strategy doc, now superseded by this one for execution but still authoritative for citations).** Integration-led GTM works for OSS dev tools when the host is itself OSS or vendor-neutral, the integration surface is narrow enough to maintain on side-project bandwidth, and the host treats the integration as canonical rather than one of many in a long-tail marketplace. Cases that validate: Vitest-via-Vite, Drizzle-via-Bun/D1/Cloudflare-Hyperdrive, shadcn-via-v0/Lovable/Bolt, Husky-as-`prepare`-script, Playwright-via-VS-Code-and-MCP. Cases that fail: dormant Storybook addons in a 200-addon catalog, dozens of `@wdio/*` reporters with sub-100 weekly downloads, third-party Cypress replay plugins after Test Replay shipped Sept 21 2023. The discriminator is always the same: does the host onboarding mention you, or do you sit in a marketplace tab nobody opens.

**Non-integration distribution (the field manual on getting from zero to "discoverable").** Three high-leverage one-shots stack: (a) Show HN posted Tue–Thu 09:00–11:00 ET with a live demo URL and a maintainer who responds in-thread within 60 minutes; (b) README hero artifact — a sub-15-second GIF that demonstrates the install-to-value path, embedded at the top of `README.md` before any prose; (c) install-command-as-marketing — `npx peek init` and `npm install -g @peekdev/cli` (or `pnpm add -D @tracelane/wdio`) are themselves the brand. Docs-as-marketing tier: a single "Why peek vs Jam.dev" / "Why tracelane vs Cypress Test Replay" comparison page that ranks for the search query nobody is paid to rank for is worth more than ten blog posts. Newsletter slot acquisition is high-leverage and slow: JavaScript Weekly (170k JS subscribers, Peter Cooper at `@peterc` reachable on X/Bluesky) accepts unsolicited submissions but only one per launch cycle; Console.dev accepts pre-1.0 tools with a personal note; Bytes.dev is a Ui.dev property and harder to land cold.

**Ethical growth hacks (Cialdini-aligned, dark-pattern-aware).** Product-as-artifact virality (Jam.dev's 200k-monthly-Jams metric is the canonical case — every output is itself an ad) is the highest-yield ethical mechanic available to a side-project OSS dev tool, but it requires the tool's output to be *intrinsically shareable*. For `peek`, this is the recording-as-permalink (post-Phase-5 stub). For `tracelane`, this is the self-contained HTML report — already shipping, and the existing "Copy as Markdown for AI" button is the kernel of the play. Cialdini's six tactics are usable ethically: reciprocity = free production-grade OSS with no signup wall; commitment = the README-as-a-checklist install path; social proof = downstream usage by named projects, not stars; authority = signed releases + DCO + SBOMs; liking = first-person maintainer voice in changelogs and issue replies; scarcity = NEVER manufactured (no "limited beta" / "request access" theater). Hard-coded dark-pattern floor: no fake stars (StarScout will catch you and the GitHub-mafia-FUD article will follow; the November 2025 wave that took down ~$3M in fake-star pump-and-dump activity is the cautionary record), no HN voting rings (your account ages out and the moderation log is more durable than any single post), no FTC-class testimonial manipulation ($51,744 per violation under the 2023 FTC Endorsement Guide revision applies even to OSS projects soliciting reviews), no manufactured outrage farming. The bright line is that every growth tactic should still work if it were transparently disclosed.

**OSS maintenance field manual (the most operationally important of the four).** The supply-chain attack surface is now the dominant existential risk for any OSS project handling user data. Three vectors specifically: (a) the `@posthog/rrweb` lineage — our pinned fork — was reportedly compromised in early 2026 via the wider Shai-Hulud 2.0 wave that abused `pull_request_target` workflows on PostHog repos (Nov 18 2025 disclosure); we vendor and pin, but a future recompromise of the unpinned mainline would still affect anyone who naively `npm install`s `@posthog/rrweb` directly (not us, but the conversation around us would still matter); (b) `pull_request_target` carelessness — the same class of misconfiguration that PostHog tripped on is one PR away from being our problem if branch protection isn't tightened; (c) the OSS sustainability cliff — solo-maintainer projects that don't open Sponsors/Open-Collective at launch lose the option later (signaling matters more than revenue at this scale; opening at zero is free). The manual's "Sustainable Cadence Proposal" — weekly ≤3h, biweekly ≤2h, monthly ≤4h, quarterly ≤1d, annually a sustainability review — is the maintenance budget. Anything that doesn't fit is either dropped or moved to community PRs.

#### 1.2 The synthesised thesis

> Integration-led distribution into vendor-neutral OSS hosts, with strict caps on integration surface, paired with product-as-artifact virality from the self-contained HTML report (tracelane) and the recording permalink (peek), defended by supply-chain discipline that treats the `@posthog/rrweb` fork as a security boundary rather than a dependency. Everything else is a distraction.

That sentence is the test for any Phase 5 decision. If a proposed tactic doesn't fit at least one of {integration-led into a vendor-neutral host, product-as-artifact mechanic, supply-chain hygiene, sustainability}, drop it.

---

### 2. Launch-readiness gates

Two gates must pass before the public Show-HN goes up. They are mutually independent — each can be worked in parallel — but neither can be skipped.

#### Gate A — supply-chain hygiene

Reference: the OSS maintenance field manual §1–§3 (supply-chain controls + `@posthog/rrweb` exposure + sustainability infrastructure). A separate `docs/pre-launch-hygiene.md` (work chunk in parallel; not yet written as of this commit) will own the line-item checklist; this section enumerates what that doc must cover.

| # | Control | Status | Owner action |
|---|---------|--------|--------------|
| A1 | Branch protection on `main` (require PR, require status checks, require linear history, no force-push, no direct admin override on protected paths) | NOT ENABLED | Maintainer flips via GitHub Settings → Branches. Carryover from Phase 4 — this is the single highest-leverage one-click hygiene item left. |
| A2 | `pull_request_target` not used anywhere in `.github/workflows/` | Audit pending | Grep `.github/workflows/*.yml` for `pull_request_target`; if any matches, justify or excise. The PostHog Nov 18 2025 compromise was specifically this misconfiguration. |
| A3 | npm Trusted Publishing OIDC + provenance | ✅ working since alpha.3 | Confirm each scope (`@cubenest`, `@tracelane`, `@peekdev`) on `npmjs.com/settings/orgs` shows provenance ribbons on the latest publish. |
| A4 | Pinned `@posthog/rrweb` fork in `@cubenest/rrweb-core` documented with commit SHA + audit trail | Documented in ADR-0002 | No action — but confirm `prds/adrs/0002-rrweb-posthog-fork-substrate.md` cites the exact pinned ref. |
| A5 | Second-publisher recruitment on at least one of three scopes | Issue #9 open, no candidate yet | Maintainer decides whether to wait for a Stage-3 contributor or accept the single-point-of-failure honestly (current `docs/SUSTAINABILITY.md` already discloses this). |
| A6 | `audit-ci --high` exits 0 on every release; `audit-ci --moderate` waivers documented in `docs/SECURITY-NOTES.md` | ✅ as of Phase 4a | Re-run before tagging the first non-alpha. |
| A7 | SBOM emitted on release (CycloneDX or SPDX JSON) | Not configured | Optional — adds defense and a credibility signal. Add `@cyclonedx/cdxgen` to release workflow when bandwidth permits. |
| A8 | Secrets scan on history (`gitleaks detect --no-banner`) | Run, no findings | One-time pre-public-push check. Re-run any time a `.env`-shaped file gets touched. |
| A9 | `pinact` / pinned action SHAs in workflows | Not done | Pin every `actions/*` and third-party action to a SHA, not `@v4`. Defense against action-source compromise. Half-day of work. |
| A10 | `CODE_OF_CONDUCT.md` + `SECURITY.md` + `CONTRIBUTING.md` linked from README and `.github/` | ✅ files exist | Confirm `.github/SECURITY.md` symlink or copy; some GitHub workflows look there specifically. |
| A11 | GitHub Sponsors + Open Collective profiles created (status: visible, not actively promoted) | Not opened | Sponsors button on the repo is free signal. Open Collective adds fiscal-host capability for future income; both are zero-revenue / zero-effort to open. Maintenance manual §4 is firm: open at launch, not after. |
| A12 | Issue templates: `bug`, `feature`, `security` (with `report privately` callout) | Partial — confirm | Sanity-check `.github/ISSUE_TEMPLATE/` exists and the security template links to SECURITY.md disclosure path. |

Gate A passes when A1, A2, A6, A8, A9, A11 are GREEN. The rest are nice-to-have or already done.

#### Gate B — first-impression artifacts

Reference: the non-integration distribution manual §2–§4 (README hero, install-command-as-brand, docs-as-marketing). This is the artifact pass — what a stranger sees in the first 90 seconds.

| # | Artifact | Status | Acceptance |
|---|----------|--------|------------|
| B1 | README hero GIF — under 6 MB, under 15 seconds, demonstrates install-to-first-value with no narration overlay | Not made | Two GIFs needed: tracelane (failing WDIO spec → opened report) and peek (`npx peek init` → MCP visible in Claude Code → "what's in my latest session"). Use `terminalizer` or `vhs` for terminal portions; ScreenStudio or `peek` itself for browser portions. |
| B2 | README "what is this" sentence above the fold, no marketing voice | Existing README is technical, needs hero rewrite | One-line description + one-line for who-it-is-not (anti-positioning is high-yield). Avoid "modern, fast, developer-friendly." See §7 for the two candidate taglines. |
| B3 | Install command above the fold — `npm i -D @tracelane/wdio` / `npx peek init` | Yes | Each product README must have the install command in the first paragraph, not buried in §3. |
| B4 | Activation under 5 minutes for both products | tracelane: ~2 min; peek: ~4 min depending on extension load | Time the cold path on a fresh machine before Show-HN. If peek's CWS-listing path can collapse the unpacked-extension-ID prompt, do it. |
| B5 | Self-marketing footer in each generated artifact | Partial | `tracelane` report HTML footer: "Generated by tracelane @ version · cubenest.com/tracelane". `peek` recording permalink footer: same shape. Tasteful, one line, removable via a config flag (per the ethical-growth manual: never make the footer mandatory). |
| B6 | Origin-story post drafted (not yet published) | Not done | One 600–900-word "why we built this" post, first-person, no marketing. Publish on `harish.dev` or equivalent, NOT on the project blog. Link from the README "Background" section but do not lead with it. |
| B7 | Demo URL live for the Show HN — a real session in a real browser, not a video | Not done (peek-docs may host this) | Choose between (a) a hosted `tracelane` report served from `apps/tracelane-docs/` (low-friction; one Astro page), or (b) a Loom-style recording of `peek` in action (because the extension is hard to demo statically). Pick one — do not split attention. |
| B8 | Comparison page: "tracelane vs Cypress Test Replay" and "peek vs Jam.dev" | Not written | Each is one Astro page in the respective docs app. Honest delta only — no FUD. The comparison page captures search intent that the competitor's own pages won't. |

Gate B passes when B1, B2, B3, B5 are GREEN for both products. B4 must be verified on a clean machine. B6/B7/B8 can ship up to one week post-launch without harm but are heavy-lift, so start now.

---

### 3. Per-product 90-day plans

#### 3.1 tracelane — Weeks 1–12

The wedge: WebdriverIO is the lowest-friction OSS host (1.93M weekly DLs, 9.6k stars, documented services contract, friendly maintainers historically). Playwright is the gravitational center (53.6M weekly DLs, 88.7k stars) but the value-add must be specifically *shareable static HTML*, not capture parity with Trace Viewer. Allure-attach is the cheapest credibility signal (`@wdio/allure-reporter` already pulls 406k weekly DLs).

| Week | Ship | Approval / channel action | Acceptance signal |
|---|---|---|---|
| 1 | `@tracelane/wdio` alpha.6 — close T-7 (CDP network capture in fixture, or document degradation explicitly) + P-18 (`--json` flag for `peek sessions list`, despite the cross-product name; this is a tracelane finding's audit-output equivalent) | None — internal | `pnpm test` green, manual QA re-run clean |
| 1–2 | README hero GIF + first-paragraph rewrite + tagline lockin | None — internal | Gate B1, B2 green |
| 2 | `tracelane/upload-report-action` v0.1 (GitHub Marketplace) — uploads the HTML report as a workflow artifact + posts a PR comment with a link | Submit to GitHub Marketplace; semver-tagged release | Listing live |
| 2–3 | `@tracelane/playwright-reporter` MVP — Reporter interface (`onTestEnd` + `onAttachment`), shareable single-file HTML output, positioning explicitly NOT capture but *attach* | None yet — wait for the package to stabilise | npm 0.1.0 published, README example green |
| 3 | `@tracelane/allure-attachment` — attaches `rrweb.html` to every Allure result so it shows in the existing Allure UI under Attachments | Email Qameta team (Artem Eroshenko) introducing the package; no PR required | Package downloads non-zero |
| 4 | PR to `webdriverio/awesome-webdriverio` adding `@tracelane/wdio` to services + reporters section | One PR | Merged within 2 weeks (historical precedent) |
| 4 | PR to `microsoft/playwright/awesome-playwright` listing | One PR | Merged or commented within 2 weeks |
| 5 | Origin-story post published on `harish.dev` (or maintainer's blog), comparison page "tracelane vs Cypress Test Replay" live in `apps/tracelane-docs/` | None — content goes live, social posts wait for week 6 | Pages indexable; canonical tags clean |
| 5–6 | Show HN: "Show HN: tracelane — self-contained HTML test-failure replays for WebdriverIO / Playwright" | Tue or Wed, 09:00–11:00 ET; maintainer in-thread for 4 hours minimum | First page for >2 hours; comments not gamed |
| 6 | JavaScript Weekly submission via the public submit form + a DM to `@peterc` on X | One submission, one DM, no follow-up if no reply | Listed in an issue within 4 weeks |
| 7 | TestJS Summit 2026 CFP submitted (talk: "What the developer console can't tell you: rrweb-based test forensics in 25 minutes") | One CFP | Acceptance or polite rejection |
| 7–8 | Currents.dev OSS reporter co-marketing — DM Andrew Goldis at Currents; offer a recipe page in tracelane-docs | One DM | Recipe page lives in tracelane-docs; reciprocal link likely |
| 9 | Selenium-WebDriver-JS thin CDP-only adapter — ~100 LOC, low marginal value, community-goodwill play | Soft-launch in WDIO Discord #plugins; no PR to selenium-hq | Demonstrable acknowledgment within 90 days |
| 9–10 | PodRocket pitch (LogRocket podcast — Elizabeth Beczynski, `elizabeth.becz@logrocket.com`) | One email | Recorded within 12 weeks ideal; otherwise queued |
| 11 | Cypress JSON-output adapter ONLY (no Test Replay overlap) — for OSS-Cypress users not on Cloud | Document in tracelane-docs; do NOT market as a "Cypress integration" | Package published; positioning held |
| 11–12 | Quarterly review against day-90 thresholds; sustainability checkpoint | Reference: §8 of this doc | Decision: continue at current cadence, escalate one integration, or pause one |

**Day-90 success thresholds (tracelane).** Calibrated against the existing `@wdio/allure-reporter` baseline (406k weekly DLs) and the structurally-comparable shadcn/ui-style integration-led growth curve.

- `@tracelane/wdio` ≥ 1,000 weekly DLs — represents ~0.25% penetration of the Allure-reporter base.
- `@tracelane/playwright-reporter` ≥ 2,500 weekly DLs — ~0.005% capture of Playwright's 53.6M weekly volume; achievable.
- `@tracelane/allure-attachment` ≥ 500 weekly DLs — additive integrations have a steeper conversion curve.
- Listed in at least 5 public template repos (search GitHub for `webdriverio.conf.ts` or `wdio.conf.js` containing `@tracelane/wdio`).
- At least one external talk / podcast accepted (TestJS Summit OR PodRocket OR JS Party OR a regional meetup recording).

Miss the wdio number specifically → it's a positioning issue, not a channel issue (see §8.2). Miss the Playwright number → it's likely a Trace-Viewer overlap perception issue, also positioning.

**Explicit defers (do NOT initiate in days 1–90).**

- Cypress full Test Replay integration (host competes; see §5).
- Vitest browser mode (host still maturing — defer to Phase 6 / when Storybook 9's first-class Vitest integration has a year of usage data).
- BrowserStack Test Observability / Sauce Labs Test Insights (commercial; defer to post-OSS expansion).
- Mabl / QA Wolf / Functionize integrations (commercial, low alignment).
- Visual regression integrations (`@argos-ci/playwright`, BackstopJS): defer to when tracelane has its own visual-diff module shipping.

#### 3.2 peek — Weeks 1–12

The wedge: MCP-host distribution is in a four-month-long compounding window (per Digital Applied: ~6.8k → ~9.4k MCP servers between Dec 2025 and Apr 2026, +38%). Microsoft's `playwright-mcp` is the proof point (33k stars, PulseMCP's #1 ranked at 54.2M cumulative est. visitors). Cursor's directory and Claude Code's MCP-add flow are the two highest-leverage distribution surfaces; Chrome Web Store is the consumer-facing alternative for users who don't yet have an AI host configured.

| Week | Ship | Approval / channel action | Acceptance signal |
|---|---|---|---|
| 1 | `@peekdev/mcp` alpha.6 — close J.6 (DOM snapshot tuning), K.2 (`--format playwright` export), P-18 (`peek sessions list --json` / `--help`) | None — internal | All four 🟡 alpha.6 annoyances flipped; release notes cite QA findings doc |
| 1 | Chrome Web Store submission for `@peekdev/extension` — privacy practices disclosure, single-purpose statement, screenshot pack, listing copy | Submit to CWS; 3–7 day review typical | CWS slot live, public ID minted |
| 1–2 | MCP registry submissions: PulseMCP (npm-scrape happens daily for `mcp` keyword), Smithery (manual server submission), mcp.so (PR to repo), modelcontextprotocol/servers (PR to official Anthropic-curated list) | Four submissions; metadata pre-filled in `docs/peek/distribution/` (Phase 3e Task 3.30) | All four listings live within 2 weeks |
| 2 | Claude Code Skill (`~/.claude/skills/peek/SKILL.md`) — distributed as part of the CLI's `peek init` flow, AND as a curl-able recipe in README | None — README change | Listed on at least one awesome-claude-skills compilation within 4 weeks |
| 2–3 | `.cursor/mcp.json` recipe in README + PR to `pontusab/cursor.directory` (the cursor.directory mirror repo) | One PR | Listed in cursor.directory within 30 days |
| 3 | Sentry Spotlight bidirectional doc link — Spotlight already has its own MCP server mode (`spotlight mcp`), so the play is cross-recommendation, not integration. Email David Cramer / `getsentry/spotlight` maintainer. | One email; no PR | Doc link landed within 90 days |
| 3–4 | README hero GIF (peek): `npx peek init` → MCP visible in Claude Code → "what's in my latest session?" returning real data. Under 15 seconds. | None — internal | Gate B1 green for peek |
| 4 | Origin-story post + comparison page "peek vs Jam.dev" (peek-docs Astro page) | Content goes live, social waits | Page indexable; honest delta (Jam = paid SaaS hosted; peek = OSS self-host MCP-native) |
| 4 | VS Code GitHub Copilot agent-mode `mcp.json` recipe in README | None — README change | Microsoft community-hub guidance referenced |
| 5 | Continue.dev + Cline + Roo Code + Windsurf + OpenAI Codex CLI bundled recipes | Five small PRs to each project's README or examples folder (or zero PRs — just our README) | Bundled in week-5 docs commit |
| 5 | Show HN: "Show HN: peek — bring your real browser to Claude Code / Cursor (OSS, self-hosted, MCP-native)" | Tue or Wed, 09:00–11:00 ET; live demo URL OR a Loom; maintainer in-thread 4h minimum | First page for >2 hours; CWS install rate spikes |
| 6 | Octomind integration recipe — peek's captured sessions feed Octomind's AI test generator. Email Marc Mengler. | One email; recipe page lives in peek-docs | Reciprocal link or co-published recipe within 90 days |
| 6–7 | Console.dev pre-1.0 submission (peek qualifies; Bytes.dev / JS Weekly defer until 1.0) | One submission via Console.dev's form | Newsletter inclusion within 6 weeks |
| 7 | r/SideProject and r/SelfHosted launch posts — different angle than Show HN. r/SideProject leads with the personal angle; r/SelfHosted leads with the "no SaaS, no telemetry, no signup wall." | Two posts, separated by 48h, separate accounts not required but separate framings | Front-page of subreddit OR not — accept either outcome |
| 8 | PodRocket pitch — `elizabeth.becz@logrocket.com`. Pitch peek specifically; tracelane is a separate pitch. | One email | Recorded within 12 weeks ideal |
| 8–9 | TestJS Summit 2026 CFP (joint talk: "An MCP-native browser companion for AI coding agents") | One CFP | Acceptance or rejection |
| 10 | PostHog Toolbar adjacency — peek's substrate IS `@posthog/rrweb`; PostHog DM is the highest-credibility-yield, lowest-effort outreach available. Frame as "we vendor your fork, here's how we use it" — no ask. | One DM to a PostHog plugins/PMs contact | Mention, retweet, or silence — all three are fine outcomes |
| 11 | First write-class action implementation (F.5 / J.7 — Level 4 real AI write via MAIN-world dispatcher) — moves peek from read-only-by-default to optional-write-with-audit. Major credibility unlock. | None yet — ship the code first | F.5 + J.7 flip from ⏸ to ✅ |
| 11–12 | Day-90 review: PulseMCP visitor count, CWS WAU, awesome-list inclusion count | Reference: §8 of this doc | Continue / escalate / pause decision |

**Day-90 success thresholds (peek).**

- PulseMCP listing live and ≥ 50,000 cumulative "Est. Visitors" — ~0.1% of Playwright MCP's 54.2M, structurally realistic for a focused tool in a less-crowded sub-niche.
- Chrome Web Store ≥ 500 weekly active users (WAU). CWS publishes install count and WAU; check both. WAU/install ratio < 30% is a separate red flag (see §8.2).
- Listed in at least 3 "awesome-claude-skills" or "awesome-mcp" community-curated lists.
- Bidirectional doc link with Sentry Spotlight live.
- Cursor.directory listing live with non-zero install signal.
- At least one external talk / podcast / newsletter feature.

**Explicit defers (do NOT initiate in days 1–90).**

- Devin, Replit Agent, Vercel v0, Bolt.new, Lovable integrations (Phase 6+ — these consume shadcn/ui-shaped artifacts; peek-as-AI-context is a longer arc).
- Sentry Session Replay attach (anti-pattern — see §5).
- Highlight.io anything (dead Feb 28 2026).
- Atlassian / Browser Company / Arc / Dia (acquisition direction unclear).
- BrowserStack Bug Capture, Marker.io, BugHerd commercial bug-tracker integrations (Phase 6+).
- Building a peek SaaS or hosted backend (sustainability anti-pattern — `docs/SUSTAINABILITY.md` §"Cadence" is explicit: no paid infra).

---

### 4. Channel matrix

Where to post what, when. Everything below has been cross-checked against the non-integration distribution manual; nothing here is a guess.

#### 4.1 Long-form (origin posts, comparison pages, docs)

| Channel | Reach | Timing | tracelane | peek | Notes |
|---|---|---|---|---|---|
| Hacker News (Show HN) | First-page = 50k–500k impressions over 24h | Tue or Wed 09:00–11:00 ET | Week 5–6 | Week 5 | Maintainer must be in-thread within 60 min and stay 4h. No voting rings (see §5). Title formula: "Show HN: \<noun\> — \<8-word benefit>". |
| `harish.dev` (or maintainer blog) — origin story | Modest direct; high SEO-anchor value | Pre-Show-HN | Week 5 | Week 4 | First-person, 600–900 words. NOT on the project blog. Link from README "Background" section. |
| `apps/tracelane-docs/` "vs Cypress Test Replay" page | Search-intent capture | Week 5 | Yes | n/a | Honest delta, no FUD. Cypress Test Replay = paid Cypress Cloud; tracelane = self-contained OSS HTML. Trust the search engines. |
| `apps/peek-docs/` "vs Jam.dev" page | Search-intent capture | Week 4 | n/a | Yes | Jam = paid SaaS; peek = OSS self-host MCP-native. Acknowledge Jam's UX is genuinely better; differentiate on category, not features. |
| `apps/peek-docs/` "vs Sentry Spotlight" page | Search-intent capture | Week 4 | n/a | Yes | This one is collaboration-flavored — Spotlight has its own MCP server mode, so the page is "use both, here's how" not "vs". |

#### 4.2 Short-form (social, threads, link drops)

| Channel | Reach | Timing | Notes |
|---|---|---|---|
| X / Twitter | High noise, low conversion | Day-of Show HN | Single post with the GIF; do not @-name competitors. Pin until traction settles. |
| Bluesky | Tech-niche, higher signal per impression | Same day | Same post; Bluesky tech-Twitter migration is real (per non-integration manual). |
| Lobsters | ~20k mostly-engineering audience | Day after Show HN if HN went well | Submit via the personal account; tag `programming` + `practices`; one of two community-tags |
| /r/webdev | ~1M | Sunday 09:00–11:00 PT | tracelane post (NOT both products in one post) |
| /r/QualityAssurance | ~80k | Same | tracelane post |
| /r/SideProject | ~250k | Different week than HN | peek post — frame personal |
| /r/SelfHosted | ~430k | Different week than HN | peek post — frame as no-SaaS-no-telemetry |
| /r/ClaudeAI | ~80k | After CWS listing live | peek post — frame as MCP-native + Claude Skill |
| /r/cursor | ~30k | After cursor.directory listing | peek post |

Cap: one social channel per day during the launch week. Avoid the "blasting everywhere in 8 hours" pattern — it reads as inauthentic and the LLMs that pattern-match for spam will flag it.

#### 4.3 Newsletters

| Newsletter | Audience | Acceptance posture | Notes |
|---|---|---|---|
| JavaScript Weekly | 170k JS developers (the canonical number) | Submit form + DM `@peterc` on X / Bluesky | One submission per launch cycle. Peter Cooper is reachable and reads submissions; do not spam. |
| Console.dev | ~50k devtools-focused | Pre-1.0 friendly; personal note helps | peek qualifies before 1.0 (devtool-shaped); tracelane wait until 1.0 (test-tool-shaped is less of a Console.dev fit) |
| Bytes.dev | Ui.dev property; React-leaning | Harder to land cold | Defer to post-1.0; not worth a cold pitch in alpha |
| Node Weekly | Subscriber overlap with JS Weekly | Submit form | Optional — overlap is high enough that JS Weekly is sufficient |

#### 4.4 Podcasts

| Podcast | Host | Contact | Status check | Notes |
|---|---|---|---|---|
| PodRocket | LogRocket | `elizabeth.becz@logrocket.com` | Active 2026 | Pitch both products separately. tracelane angle: "self-contained test replays"; peek angle: "MCP-native browser companion". |
| Syntax.fm | Wes Bos / Scott Tolinski | X DM (`@wesbos`, `@stolinski`) | Active 2026 | Long-shot; only pitch after first traction signal. |
| JS Party | Changelog | n/a — show ended 2025 | DEAD | Do not pitch. |
| Changelog Friends | Changelog network | Active | Active 2026 | Successor to JS Party in spirit; Adam Stacoviak is reachable. |
| The Changelog | Changelog | Pitch via changelog.com | Active 2026 | Higher bar; long-shot pre-1.0. |
| Devtools.fm | Andrew Lisowski + Justin Bennett | X DMs | Active | Pitch peek specifically. |

#### 4.5 Conferences (CFPs)

| Conference | Date / format | CFP timing | Pitch |
|---|---|---|---|
| TestJS Summit 2026 | Amsterdam + online | Submit before launch (CFPs typically close 4–6 months ahead) | tracelane talk: "What the developer console can't tell you" |
| AssertJS | Florida / annual | Variable | tracelane talk; QA-engineer audience |
| JSNation 2026 | Amsterdam + online | Same shop as TestJS Summit | peek talk if tracelane gets the TestJS slot, or vice versa |
| MCP Day / AAIF events | TBD | Watch for announcements | peek talk — the MCP-host audience is the right one |

#### 4.6 Install-command-as-marketing

Every README must lead with the install command, not prose. This is a high-leverage convention from the non-integration distribution manual.

```bash
# tracelane (WDIO)
npm install -D @tracelane/wdio
# add to wdio.conf.ts: services: [['tracelane', {}]]

# peek
npm install -g @peekdev/cli
npx peek init
# install the Chrome extension from the Web Store
```

The install command is more durable than any tagline. Get it short, get it right, get it above the fold.

#### 4.7 What NOT to post and where

The non-integration manual's anti-channel list. Save the time:

| Channel | Why not |
|---------|---------|
| Product Hunt | Audience is product-hunters, not engineers. The conversion to actual usage on a developer tool is well-documented to be poor. The "Product of the Day" badge is a signal that doesn't translate. Defer to post-1.0 IF the tool has a non-engineer use case (peek arguably does; tracelane does not). |
| BetaList | Audience is "beta listers"; same problem amplified. Skip. |
| Indie Hackers | Founder-focused; the audience overlap with "engineer who needs a test-failure-replay tool" is small. Defer. |
| Most Discord communities | Posting in Discord communities you haven't been a contributor in for at least a month reads as drive-by spam. The credible Discord post is from a community member, not a launcher. |
| Quora / Stack Overflow self-answer | Both platforms detect self-promotion patterns and will down-rank. The cleanest play is to genuinely answer questions where the product is relevant, with a disclosure, and not flood. |
| Generic dev Slack workspaces | Same as Discord — be a community member first. |
| LinkedIn | Acceptable for a maintainer post but NOT for product-anchored content. LinkedIn's audience for OSS dev tools is "engineering managers evaluating" not "engineers adopting"; different conversation. |
| Dev.to | Cross-posting a blog post is fine; do NOT use Dev.to as the primary venue. The SEO signal from `harish.dev` (or equivalent owned domain) is more durable. |

#### 4.8 Awesome-list submission targets (one PR each, batch in week 4)

| List | Repo | Target product | Notes |
|------|------|---------------|-------|
| awesome-webdriverio | `webdriverio/awesome-webdriverio` | tracelane | Services + reporters section; PR. |
| awesome-playwright | `mxschmitt/awesome-playwright` | tracelane | Reporters section; PR. |
| awesome-mcp | `punkpeye/awesome-mcp-servers` (and the half-dozen forks) | peek | Submit the canonical PR to the most-starred fork; others typically sync. |
| awesome-claude-skills | several emerging; track via GitHub search | peek | Once one ~stable list emerges as canonical, PR it. |
| awesome-cursor | `pontusab/cursor.directory` | peek | Combined with the cursor.directory listing. |
| awesome-mcp-clients | `punkpeye/awesome-mcp-clients` | peek (as adjacent reference) | If listed, frame as "browser companion for X clients" |
| awesome-selfhosted | `awesome-selfhosted/awesome-selfhosted` | peek | Niche fit — qualifies under "developer tools / debugging" |

---

### 5. The hard "never do" list

From the ethical-growth-hacks manual's anti-patterns chapter, condensed and ordered by frequency-of-temptation for solo-OSS-maintainers. These are not soft preferences; they are hard rules. Crossing one of them is a Phase-5-failure event and triggers a documented retraction.

1. **No bought stars / fake stars.** StarScout (Carnegie Mellon, 2024) — and successor detection methods — identify purchased-star clusters by graph topology: cluster co-membership, account-creation-time bunching, repo-graph distance, time-since-last-action distribution. The November 2025 wave that flagged ~$3M of fake-star pump-and-dump activity (the well-documented one that scraped purchasing receipts from a stars-for-sale Telegram channel) is the canonical record. A flagged repo loses credibility instantly and permanently; the social cost is far higher than the marginal credibility upside of inflated stars. Concretely: do not accept "I'll get you some stars" offers from anyone in any DM, ever.
2. **No HN voting rings.** Your HN account history is permanent; the moderation log is permanent; the moderation team has a documented practice of talking to maintainer accounts when patterns look off (`dang`'s own posts confirm this — moderation is ad-hoc but consistent). The downside is a public ban with no appeal; the upside is at most one extra Show HN slot. Asymmetric. Concretely: do not ask anyone — friends, family, day-job colleagues — to upvote a Show HN post. The post stands on its own or it doesn't.
3. **No FTC-class testimonial manipulation.** The 2023 FTC Endorsement Guide revision (effective Aug 24 2023, with the per-violation penalty adjusted to $51,744 by the January 2024 Federal Register update) applies to OSS projects soliciting reviews — the threshold is "material connection," not "commercial transaction." "Hey, would you tweet that you tried our tool" with the implicit reciprocal expectation is in the gray zone. Concretely: any solicitation of public commentary on the product is either disclosed (e.g. "Maintainer asked me to try this and share — here's what I think") or doesn't happen.
4. **No `pull_request_target` carelessness.** The PostHog Nov 18 2025 compromise vector. PostHog had a workflow that ran `pull_request_target` with secrets exposure on PR-from-fork builds; the attacker submitted a PR that exfiltrated the `NPM_TOKEN`, then published a compromised `posthog-js` minor version that lived for ~6 hours before detection. This is also Gate A2; restated as a hard rule because the temptation to "just enable secrets on PR builds for convenience" is recurring. Concretely: any new workflow with `pull_request_target` requires written justification in the PR description AND a second reviewer (which, at bus-factor-1, means the maintainer must wait 24h and re-review with fresh eyes).
5. **No fabricated scarcity.** "Limited beta", "request access", "waitlist" theater on a public-OSS project reads as manipulation. We have no scarcity. Saying "early access — message me" when the code is on npm is dishonest. Concretely: the install command is in the README; that IS the access flow.
6. **No dark-pattern unsubscribe.** If `apps/{tracelane,peek}-docs/` ever ships a newsletter signup, it is one-click unsubscribe, no confirmation modal, no "are you sure" interstitial. The unsubscribe link works without requiring login. This is FTC-required for CAN-SPAM and ethically required regardless.
7. **No fake "X% of teams" testimonials.** If we cite usage, it's named or it doesn't get cited. "Trusted by 1000+ teams" with no list is a tell. We do not have 1000+ teams and saying we do would be a fast credibility loss when it's checked.
8. **No "feature gates" on the OSS product to push a SaaS that doesn't exist.** We don't have a SaaS. If we ever do, the OSS product remains feature-complete for self-host. `docs/SUSTAINABILITY.md` is the binding document. Concretely: every feature shipped to `tracelane` or `peek` must work fully on a local machine with no remote service ever contacted. "Pro features require an account" is forbidden.
9. **No XZ-Utils-style social-engineering vulnerabilities.** The XZ Utils 2024 compromise (CVE-2024-3094, disclosed by Andres Freund Mar 29 2024) was a ~2-year social-engineering campaign in which "Jia Tan" (likely a state actor) built maintainer trust through legitimate contributions then introduced a backdoor via build-script manipulation. Counter: every co-maintainer goes through a documented Stage-1 → 2 → 3 contribution arc (per §9.4); no first-PR-merge-rights ever; the calendar period of trust-building is longer than a single social-engineering campaign can sustain.
10. **No GitHub Actions with unpinned versions on the release path.** `actions/checkout@v4` becomes a SHA in any workflow that touches publishing or has access to secrets. `pinact` automates this. Half-day of work; eliminates an entire class of supply-chain compromise. The Tj-actions/changed-files compromise (March 14 2025; CVE-2025-30066) is the canonical case — a popular action with ~23k repos depending on it had its tags rewritten to point at a compromised commit; repos pinned to SHAs were unaffected.
11. **No "modern, fast, developer-friendly" filler.** The maintainer hates it; the readers also hate it but don't say so. Every adjective in user-facing copy must have a citation, a number, or a specific verb-first benefit. (See §7 for positioning principles.) Concretely: if you can replace the adjective with "good" without changing the meaning of the sentence, the adjective is filler.
12. **No silent telemetry, ever.** Neither product makes a network call we didn't disclose in the privacy policy. `docs/peek/PRIVACY_POLICY.md` is the binding document for peek. tracelane has no network surface by design. Concretely: any new dependency that opens a socket on import (yes, this happens — `node-ipc` notoriously did) gets flagged and either removed or wrapped.
13. **No "Star this repo" popups, banners, modals, or footers.** If someone stars, they star. The conversion delta from a star-beg banner is small (~2–3% on most repos that have tried it) and the credibility delta is large and negative. The cleanest repos in the JS ecosystem (Vitest, Hono, esbuild) do not beg for stars. We won't either.
14. **No fabricated traction in conference / podcast pitches.** "Used by X" is a citation-required claim. If we don't have public usage signals, the pitch describes the tool honestly: "Pre-1.0, side-project, looking for the right early users." Pitches like this work; pitches that inflate work for one cycle then poison the relationship.
15. **No coordinated multi-channel posting in an 8-hour window.** Posting on HN, Lobsters, Reddit-x4, X, Bluesky, LinkedIn, and 3 Discords in the same morning reads as a coordinated launch by an LLM-trained marketing operation, not as a developer who cares. The non-integration manual is explicit: stagger by 48h minimum across channels; lead with one channel and let traction recruit the others organically.
16. **No removal of negative reviews / issues.** A snarky issue or a critical Reddit comment stays up. Engage on substance or ignore. Locking an issue because it's critical is a worse signal than the criticism itself.

---

### 6. Risk register

Format: risk · likelihood (L/M/H) · impact (L/M/H) · mitigation · status

| # | Risk | L | I | Mitigation | Status |
|---|------|---|---|-----------|--------|
| R1 | `@posthog/rrweb` upstream re-compromise (Shai-Hulud 2.0 successor) | M | H | Vendored fork pinned by commit SHA; ADR-0002 documents the audit trail. Any unpinned-mainline compromise affects perception, not our code. Maintenance manual §1 controls in place. | Mitigated; monitor PostHog disclosures |
| R2 | Cypress / Playwright build native rrweb-style capture, obsoleting tracelane's capture-layer | H | H | Position around *shareable static HTML* (the artifact) + AI-feeding (the Markdown copy) — not capture parity. Cypress already shipped Test Replay Sept 2023; we already lost the capture-parity argument. | Positioning held |
| R3 | Allure adds native rrweb support | L–M | H | `@tracelane/allure-attachment` is *additive* — uses Allure's attachment format. If Allure ships native, we either deprecate or co-publish; either is OK because the cost is low. | Designed to survive |
| R4 | MCP transport spec churn (Streamable HTTP, OAuth 2.1, AAIF working-group changes) | M | M | Use Anthropic-maintained reference SDKs; follow AAIF roadmap. Pin to MCP SDK majors. | Active monitor |
| R5 | Chrome MV3 churn (`debugger` permission policy, service-worker lifetime, optional-permission scope changes) | M | M | P-14 already taught us this — `debugger` moved from optional to required in alpha.4. One-file-per-host adapter pattern keeps blast radius small. | Reactive — monitor Chromium release notes |
| R6 | WDIO 9→10 / Playwright minor-monthly releases break our adapter | H (certain) | L if scoped | Pin to host LTS where one exists; one file per host's adapter; quarterly maintenance budget allocated. | Designed in |
| R7 | Solo-maintainer burnout / Capillary Tech day-job conflict | M | H | Maintenance manual §4 cadence (weekly ≤3h, biweekly ≤2h, monthly ≤4h, quarterly ≤1d); explicit "do not quit day job" floor (§9). Second-publisher recruit at Stage 3. | Discipline-dependent |
| R8 | Chrome Web Store sudden takedown (policy disagreement, false report, automated content scan) | L–M | H for peek | Maintain a "GitHub Releases unpacked-bundle" install path as fallback; document it in peek-docs at launch. CWS = nice-to-have, not single-channel-of-truth. | Mitigated |
| R9 | Manufactured-signal accusation (someone claims we bought stars / ran a ring) | L | M | Public commit log + StarScout's public methodology + cleanly documented growth = defensible. The defense is the discipline (§5) not a response plan. | Discipline-dependent |
| R10 | Decipher AI / Jam.dev raises a Series A and aggressively expands into our wedge | M | M | Differentiate on (a) OSS license, (b) MCP-native, (c) self-host — none of which they offer as of May 2026. Monitor; do not react to announcements unless they ship code. | Monitor |
| R11 | Jam.dev launches an OSS tier or open-sources core | L | H | Beat them to MCP/Skill default-status before they can. The 90-day window is the window. | Time-pressured |
| R12 | Highlight.io fork emerges post-Feb 28 2026 shutdown | L | L | Not our problem unless they vendor `@cubenest/rrweb-core`; in which case we coordinate. | Monitor |
| R13 | npm scope squat / Cubenest typosquat | L | M | Already published the canonical scopes; consider defensive registrations (`@cubenest-rrweb`, `@cubnest`) — half-day, low priority. | Optional defense |
| R14 | A high-severity advisory lands on a runtime-path dependency of a `@tracelane/*` or `@peekdev/*` package | M | H | `audit-ci --high` exits 0 on every release; if a new high lands, block release until pinned forward. Documented re-run convention in `docs/SECURITY-NOTES.md`. | Process in place |
| R15 | Conference talk gets accepted and the maintainer can't attend (day-job conflict) | M | L | Pre-record a backup talk video; offer to convert in-person → recorded if needed. Most conferences accept this. | Backstop plan |
| R16 | Show HN flop (no first page, < 50 upvotes) | M | L (recoverable) | Re-pitch with a different angle 6–8 weeks later; one re-pitch per product per quarter is acceptable. Don't double-down in the same week. | Acceptable outcome |
| R17 | Branch protection NOT enabled before a community PR introduces a malicious workflow | M | H | Gate A1 — enable BEFORE the public push, full stop. | Carryover from Phase 4; one-click fix |
| R18 | Anthropic deprecates or fundamentally changes Claude Skills model | L–M | M for peek | Skills are token-efficient but not the only distribution surface; peek's MCP path remains valid. Keep both. | Diversified |
| R19 | The CWS listing review rejects the extension on `debugger` permission grounds | L–M | M | The privacy policy + permission justification doc are written specifically for this (`docs/peek/PRIVACY_POLICY.md`, `docs/peek/PERMISSION_JUSTIFICATION.md`). Worst case: a 1–2 week appeal cycle. | Documented |
| R20 | An "ethical growth" tactic gets called out as inauthentic in public | L | H | The discipline floor in §5 is the prevention. If accused: full disclosure, apology, retract, never repeat. The maintenance manual's reputation chapter is binding. | Discipline-dependent |

---

### 7. Positioning

#### 7.1 The two candidate taglines

**tracelane:**

> The reporter for your WebdriverIO, Playwright, and Cypress tests. Self-contained HTML for every run — replay failures, audit successes, attach to any bug tracker. No SaaS, no dashboard, no signup.

**peek:**

> Your real browser, exposed to your AI coding agent over MCP — capture once, query forever, never leaves your machine.

These are durable, not clever. They name the consumer (your WDIO/Playwright/Cypress tests / your AI agent), the artifact (HTML report per run / MCP-exposed browser), and the constraint that differentiates us from the alternative (no SaaS, no dashboard, no signup / never leaves your machine). tracelane is deliberately positioned as **the reporter** — failure replay is the headline use case but the artifact lands on every run, including green ones (audit trail, evidence-in-PR, "what changed between green and red"). They will outlive any clever one-liner.

#### 7.2 Positioning principles (carry forward into all copy)

- **No filler adjectives.** "Modern, fast, developer-friendly" describes nothing. The reader cannot picture it; the LLM that summarizes our README cannot use it. Every adjective needs a number or a verb-first benefit.
- **Anti-positioning is high-yield.** Saying what we are NOT clarifies what we ARE. tracelane is "not a SaaS test-replay product like Cypress Cloud or Replay.io"; peek is "not a session-replay product for production traffic like Sentry or LogRocket." This is the kind of copy LLMs cite when summarizing the category.
- **Category creation vs category entry.** tracelane is a *category-entry* (test-failure-replay is an existing category; we differentiate on shareability + self-host). peek is closer to *category-creation* (MCP-native browser-companion-for-AI-agents is new enough to define). Different copy strategies: tracelane competes on a known-buyer-question ("what should I attach to my flake bug report?"), peek answers a question users haven't yet asked but will ("how do I give my AI agent access to my real browser without giving it SSH?").
- **First-person, technical voice.** The closest tone reference is `docs/SUSTAINABILITY.md` and `docs/qa/peek-qa.md` — terse, specific, no marketing voice. The reader is another engineer.
- **One claim per sentence.** Stack of single-claim sentences > paragraph of mixed claims.

---

### 8. Success thresholds and what changes the plan

#### 8.1 Day-90 thresholds (restated for the table-flipping use case)

| Metric | tracelane | peek |
|--------|-----------|------|
| Headline integration weekly DLs | `@tracelane/wdio` ≥ 1,000 | `@peekdev/mcp` ≥ 50k cumulative PulseMCP visitors |
| Secondary integration | `@tracelane/playwright-reporter` ≥ 2,500 weekly DLs | CWS ≥ 500 WAU |
| Tertiary | `@tracelane/allure-attachment` ≥ 500 weekly DLs | Listed in ≥ 3 awesome-claude-skills/mcp lists |
| Ecosystem signal | Listed in ≥ 5 template repos | Bidirectional Sentry Spotlight doc link |
| External voice | ≥ 1 talk OR podcast OR newsletter | ≥ 1 talk OR podcast OR newsletter |

#### 8.2 Re-evaluation triggers

- **`@tracelane/wdio` < 100 weekly DLs at day 60.** Positioning issue, not channel issue. The WDIO ecosystem is small but accessible; if 60 days of integration + listing + Show HN can't land 100 weekly DLs, the tagline / hero GIF / first-paragraph copy is wrong. Re-do, don't push harder.
- **`@peekdev/mcp` not in PulseMCP top-200 by visitor count at day 60.** Either the registry submission is misformatted, or the keyword targeting (`mcp` keyword) isn't catching, or the product description doesn't differentiate from `playwright-mcp`. Investigate before pushing more launch channels.
- **CWS WAU / install ratio < 30%.** People install, try, and don't come back. Onboarding-flow problem in the extension itself (probably the `peek init` step or the unpacked-extension-ID flow). Rework activation BEFORE any more push. The maintenance manual is explicit: don't fix distribution problems by adding distribution; fix the product.
- **A confirmed `@posthog/rrweb` mainline compromise.** Trigger the exit-to-upstream plan documented in `docs/SUSTAINABILITY.md` "Wind-down plan" — but BEFORE that, execute a targeted communications response: a CVE-citing blog post, an npm `deprecate` notice on affected versions IF affected (we vendor by SHA so likely not), a banner in the README explaining what we did and why. The compromise is the test of the supply-chain discipline; the response IS the credibility unlock.
- **A high-severity advisory on a runtime-path `@tracelane/*` or `@peekdev/*` dep.** Block release, pin forward via `pnpm.overrides`, document in `docs/SECURITY-NOTES.md`, ship a patch release. Re-run convention is in place.
- **Maintainer's weekly time budget exceeded for 3 consecutive weeks.** Drop one initiated workstream — not "add a co-maintainer" reactively. The sustainability cadence is the cap.
- **A community PR introduces a credible feature ahead of plan.** Merge it (assuming code quality + tests). Accept that the roadmap is now what the community ships, not what we ship. This is the healthy version of community traction.

#### 8.3 What does NOT change the plan

- A bad Show HN result. One slot; re-pitch 8 weeks later with a different angle.
- A competitor announcement without shipped code. Announcements are not threats.
- A spike in stars without download growth. Stars are not usage.
- Negative comments on Reddit / X / HN that are not about substance. Engage on substance; ignore the rest.

---

### 9. Sustainability and bus factor

Reference: `docs/SUSTAINABILITY.md` (current binding doc) + the OSS maintenance field manual §4 ("Sustainable Cadence Proposal").

#### 9.1 The maintenance budget

Hard caps. Anything that doesn't fit is dropped or moved to community PRs.

| Cadence | Time | Allocated to |
|---------|------|--------------|
| Weekly | ≤ 3h | Issue triage; security report review; one substantive PR review |
| Biweekly | ≤ 2h | Roadmap check against §3; one social-channel post if appropriate |
| Monthly | ≤ 4h | One feature ship OR one integration ship; release management |
| Quarterly | ≤ 1d | Sustainability review (per `docs/SUSTAINABILITY.md`); risk register update; podcast/talk submission cycle |
| Annually | 1–2d | The big sustainability review (per `docs/SUSTAINABILITY.md` §"Sustainability review cadence"); deprecation decisions; license decisions; trademark decisions |

Total: ~10h/week peak, ~4–6h/week steady-state. This is the budget. If a Phase 5 initiative is consistently exceeding it, that initiative is dropped, not the budget.

Concrete examples of "dropped":

- A feature request that requires more than 4h to spec well: closed with "out of scope for the maintenance budget; PRs welcome" and labeled `community-pr-welcome`.
- An integration target outside the 5-per-product cap (§3): same disposition.
- A long thread on a non-actionable issue: locked-as-resolved after 2 weeks if no concrete next step emerges.
- A conference talk acceptance that requires day-job-PTO and travel: declined gracefully, OR converted to pre-recorded if the conference allows.

The discipline is in saying no on the specific examples, not on the principle. Maintainers who agree with the budget in principle but say yes to each individual request are the ones who burn out at month 8.

#### 9.2 The day-job floor (non-negotiable)

The Capillary Tech day job is the financial floor. tracelane and peek are side projects per `prds/shared-preamble.md` §4. Sponsorship income — if it ever happens — supplements infra costs (currently zero) and conference travel; it does not replace the day job. The OSS maintenance manual's worked-example chapter is firm: solo OSS maintainers who quit their day jobs to maintain at 1.0–10k-user scale do not generally make it. Don't be the worked example.

#### 9.3 Financial infrastructure (open at launch, even at zero)

- **GitHub Sponsors:** open for `harry-harish`. Default tiers. No goals visible (goal-setting at zero looks insecure; just be there). Per the maintenance manual: opening at launch is free signal; opening at month 6 is a credibility problem.
- **Open Collective:** open the `tracelane` and `peek` collectives under a fiscal host (Open Source Collective is the standard one). Same logic — open at zero, don't promote, but be there.
- **No Patreon, Ko-fi, Buy Me a Coffee.** They fragment attention. Pick two channels, leave it.

#### 9.4 Bus factor

Current: bus factor = 1. This is honestly disclosed in `docs/SUSTAINABILITY.md`. Plan to escalate:

- **Stage 1 (any contributor):** merged at least one substantive PR (not a typo fix). Recognised in CONTRIBUTORS / `git log`. No special rights granted. The signal we're looking for: code quality, response to review, willingness to iterate.
- **Stage 2 (recurring contributor):** merged at least three PRs across at least two months. Invited to a private Discord/Slack/Element room (if one exists by then; if not, by email thread). Granted GitHub issue-triage rights (`triage` role) — can label, assign, close non-substantive issues. Still no publish rights. The signal we're looking for: judgement on what matters, willingness to say no to bad PRs, willingness to invest unpaid time in reviewing.
- **Stage 3 (potential co-maintainer):** has demonstrated taste, security awareness, and bandwidth across at least six months. Offered npm scope publisher rights to one of `@cubenest`, `@tracelane`, or `@peekdev` — incrementally, scope by scope, never all three at once. Granted GitHub `maintain` role (can edit settings except admin/billing). Required to enable 2FA + hardware key on both GitHub and npm accounts before the grant lands. This is the XZ-Utils-counter-measure: trust is earned over a calendar period (≥6 months) that's longer than a single social-engineering campaign can sustain.

Issue #9 is the open tracking issue. Phase 5 does NOT block on filling it; honest disclosure is sufficient until a real candidate emerges.

Anti-pattern to avoid: granting Stage-3 rights to a contributor who is enthusiastic but has only been around for 4 weeks. The two-year XZ Utils timeline is the upper bound; the 6-month threshold here is the practical lower bound for solo OSS projects. Faster grants are the documented vector for compromise.

#### 9.5 Wind-down plan reference

If a sustainability review (annual) decides to wind down, `docs/SUSTAINABILITY.md` "Wind-down plan" is the binding sequence: status banner → GitHub archive → npm deprecate → transfer/rename → security advisory channel stays open. This document does not re-litigate; it points at the existing plan.

---

#### 9.6 The reputation account

The OSS maintenance manual frames maintainer reputation as a savings account, not a checking account: every honest action deposits, every dishonest one withdraws, and the balance compounds over years. Phase 5 is about deposits.

Concrete deposits available in days 1–90:

- Every public response to an issue with technical specificity (not just acknowledgment).
- Every changelog entry that cites a finding number or external bug report.
- Every release that ships with a provenance attestation and a signed tag.
- Every privacy-policy honest disclosure that other tools omit.
- Every "we were wrong about X, here's what changed" post.

Concrete withdrawals to avoid:

- Defensive replies to legitimate criticism.
- Silence on security reports beyond 72h.
- Marketing claims that get fact-checked and don't hold.
- Promises about features or timelines that don't ship.

The account is per-maintainer (you, personally) and partially per-product. The two are linked: a credible maintainer can carry a struggling product across a rough launch; an uncredible maintainer cannot rescue a well-built product. Per the maintenance manual: the reputation account is the only thing that compounds in a side-project OSS posture; the code does not compound on its own.

---

### 10. Open questions for the maintainer

These are decisions only you can make. They should be made consciously before pushing to public.

1. **Branch protection toggle timing.** Gate A1 is one click. Are you flipping it before the public push (correct answer per supply-chain discipline) or after the Show HN settles (only acceptable if you can guarantee no community PR lands during the window)? Default: flip before push.
2. **Second-publisher / co-maintainer recruitment posture.** Issue #9 stays open. Are you ACTIVELY recruiting (post a "looking for co-maintainer" RFC pinned issue) or PASSIVELY waiting for a Stage-3 contributor to emerge organically? Active recruitment is faster but invites lower-quality candidates; passive is slower but selects for taste. Default: passive, with the issue visibly open. Reconsider at the 6-month sustainability review.
3. **Sponsorship infrastructure timing.** §9.3 says open at launch. Concretely: open GitHub Sponsors and Open Collective in the same week as the Show HN, or stagger? Default: same week. Less attention, but visible.
4. **The peek MCP write-path (Level 4 / F.5 / J.7) — ship in week 11 or defer to Phase 6?** Week 11 is a credibility unlock (read-only-by-default is a story; read-write-with-audit is a stronger story). But it's also a real engineering sprint. Default: ship in week 11 only if days 1–8 land cleanly. Otherwise defer with a clear public commitment to Phase 6.
5. **The CWS unpacked-extension-ID UX friction.** The current `peek init` flow asks the user to paste their unpacked extension ID. Once CWS approves, the slot has a stable ID and this prompt can be skipped for store-installed users. Are you treating the post-CWS-approval UX collapse as a Phase 5 task or a Phase 6 task? Default: Phase 5, week 2–3, AFTER CWS approval lands. Saves the day-90 WAU/install ratio (see §8.2 trigger).

---

### Appendix A — what to measure weekly (the dashboard, if there were one)

The non-integration manual is firm: a side-project OSS dev tool does not need a real-time dashboard. It needs a weekly check-in against ~8 numbers. Track these in a single `docs/PHASE_5_METRICS.md` (parallel work chunk; not in this commit) or a plain notebook entry.

| Metric | Source | Cadence | Threshold for concern |
|--------|--------|---------|----------------------|
| `@tracelane/wdio` weekly DLs | npmjs.com `/package/@tracelane/wdio` | Weekly Mon AM | < 100 at week 8 → §8.2 trigger |
| `@tracelane/playwright-reporter` weekly DLs | npmjs.com | Weekly | < 200 at week 8 → re-examine positioning |
| `@tracelane/allure-attachment` weekly DLs | npmjs.com | Weekly | < 50 at week 8 → Allure team didn't acknowledge — check |
| `@peekdev/cli` weekly DLs | npmjs.com | Weekly | < 200 at week 8 → CWS funnel issue |
| `@peekdev/mcp` weekly DLs (best proxy for MCP-host invocations) | npmjs.com | Weekly | < 100 at week 8 → MCP-host registry submissions misformatted |
| PulseMCP est. visitors for `@peekdev/mcp` listing | pulsemcp.com/servers/@peekdev/mcp (when live) | Weekly | < 5k cumulative at week 8 → not indexed; check listing |
| CWS WAU + install count | dashboard.cws.dev (or whatever the CWS dev console shows) | Weekly | WAU/install < 30% → §8.2 trigger |
| GitHub repo stars | `gh api repos/Cubenest/rrweb-stack` | Weekly | A spike of >100/day with no corresponding HN/Reddit/Twitter signal → potential fake-star inflation; investigate before accepting |
| Open issues count + age of oldest unanswered | `gh issue list` | Weekly | Any unanswered > 14 days → maintenance-budget signal |

Total time to capture all of this: ~10 minutes a week. The discipline is in capturing it consistently, not in the volume.

### Appendix B — sequenced first-week of public launch (the cold-start playbook)

The non-integration manual's specific advice for "the week of the Show HN" — applied to our case.

**Sunday before:**
- Final Gate-A / Gate-B check (§2). If anything is red, postpone by one week, no exceptions.
- Confirm both products' npm `latest` tags point at the alpha.6 (or 1.0-rc) builds.
- Confirm the docs sites (`apps/tracelane-docs`, `apps/peek-docs`) deploy is green.
- Confirm the README hero GIFs render correctly on github.com (different from local — github.com strips some features).
- Pre-write 3–5 candidate Show-HN replies for the most-likely critical questions (positioning vs Cypress Test Replay; comparison to Jam.dev; why-MCP-vs-just-CDP).

**Tuesday 09:00 ET:**
- Show HN goes up. (Tuesday is statistically the highest-traction day per `news.ycombinator.com/showhn` historical analysis; Wednesday is acceptable backup.)
- Maintainer in-thread, no other meetings. 4-hour minimum availability.
- DO NOT post to other channels yet. Let HN run.

**Tuesday EOD:**
- If front-page: thread responses continue. Pin the post on X / Bluesky.
- If not front-page: not a crisis. Move to Wednesday Reddit plan.

**Wednesday:**
- IF HN went well: post to Lobsters mid-morning (one community-tag, not a flood).
- IF HN flopped: cool-off. Don't double-post in the same week.

**Thursday:**
- Subreddit post — choose ONE of /r/webdev (tracelane) or /r/SideProject (peek) for the day. Different framing than HN — personal angle for SideProject, technical angle for webdev.

**Friday:**
- Newsletter submissions (JS Weekly, Console.dev) — let them sit in the queue over the weekend.
- Maintainer time: 0 — long weekend. The internet doesn't need engagement on Friday afternoon Show HN follow-ups.

**Monday (week 2):**
- Check the dashboard (Appendix A). Document what happened in `docs/PHASE_5_METRICS.md`.
- Adjust week-2 plan based on signal.

The discipline here is the spacing. Posting to 8 channels in a 6-hour window is the spam pattern; one credible channel per day with a maintainer paying attention is the signal pattern.

### Appendix C — citations and source map

Inline citations are deferred to the four source research deliverables — this doc synthesises rather than transcribes. The map:

- §1.1 paragraphs map 1-to-1 to the four research docs. Numbers in §1.1 ("170k JS Weekly subs", "53.6M Playwright weekly DLs", "33k playwright-mcp stars", "200k monthly Jams", "$51,744 FTC per-violation", "~6.8k → ~9.4k MCP servers", "$3M fake-star pump-and-dump") are taken from the research docs verbatim; cross-verify against npmtrends / FTC Federal Register / Digital Applied / StarScout publications before quoting externally.
- §3 week-by-week plans use the integration-led distribution doc Part D as their skeleton; numbers in success thresholds use the integration-led doc's §A1 case-study calibrations.
- §4 channel matrix uses the non-integration distribution doc as primary source.
- §5 "never do" list uses the ethical-growth-hacks anti-pattern catalog as primary source.
- §6 risk register synthesises §A3 of the integration-led doc with the supply-chain risks chapter of the OSS maintenance manual.
- §9 sustainability uses `docs/SUSTAINABILITY.md` (current) + the OSS maintenance field manual §4 (sustainable cadence proposal).

### Appendix D — what's intentionally NOT in this doc

- Per-package CHANGELOG entries — handled by Changesets, not strategy docs.
- The pre-launch-hygiene line-item checklist — separate `docs/pre-launch-hygiene.md` work chunk (parallel; not in this commit).
- The QA findings detail — owned by `docs/qa/findings-2026-05-28.md`.
- The privacy policy detail — owned by `docs/peek/PRIVACY_POLICY.md`.
- The permission-justification copy for the CWS submission — owned by `docs/peek/PERMISSION_JUSTIFICATION.md`.
- The CONTRIBUTING / CODE_OF_CONDUCT / SECURITY policy specifics — owned by the root-level files of the same names.
- A marketing budget. There is none. This is a side project.

### Appendix E — review cadence for this doc

- Weekly review during launch weeks 1–6: re-check §3 week-by-week tables, mark ship/defer, update day-90 trajectory.
- Biweekly review during weeks 7–12: §6 risk register + §8 trigger checks.
- Quarterly review after day 90: rotate this entire doc — what worked, what didn't, what to keep for the next 90-day cycle.

This document is durable; the week-by-week tables are not. Edit them ruthlessly.
