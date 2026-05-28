# Phase 4c — manual QA runbook

Harish — walk this before flipping the repo public. Each checklist item is a thing your day-1 user will try in the first 10 minutes after `npm install`. If it bounces them, it burns a download we worked hard to earn.

## Why now (the burn-rate framing)

The day-90 download thresholds in [`docs/tracelence-peek-dev-distribution.md`](../../../docs/tracelence-peek-dev-distribution.md) (one level up, outside this repo) are:

- `@tracelane/wdio` ≥ **1,000 weekly downloads** (calibrated against `@wdio/allure-reporter`'s 406k/wk baseline — ~0.25% penetration)
- `@tracelane/report` via Allure attach mode ≥ **500 weekly downloads**
- peek MCP server: PulseMCP "Est. Visitors" ≥ **50k cumulative** (vs Playwright-MCP's 54.2M baseline)
- peek Chrome Web Store ≥ **500 WAU**

A first-install bounce — "the package crashed when I added it" / "Claude returned nothing useful" — burns a download. Every bounce that happens before someone files an issue is invisible feedback you'll never see. **This QA exists to catch the bounces.**

Two checklists, both in this directory:

- [`tracelane-qa.md`](./tracelane-qa.md) — WDIO service end-to-end with the bundled fixture
- [`peek-qa.md`](./peek-qa.md) — extension + CLI + MCP + native host, against Claude Code (and optionally Cursor / Windsurf / VS Code Copilot)

A runnable WDIO fixture lives in [`fixtures/tracelane-demo/`](./fixtures/tracelane-demo/) — use it for the tracelane checklist's Groups A–F. Copy the dir somewhere clean (not inside the monorepo) and run there.

## Prerequisites

| Tool | Required | How to check |
|---|---|---|
| Node | ≥ 22.0.0 LTS | `node -v` — if not 22+, `nvm use` from a dir with `.nvmrc`. The repo root has one. |
| pnpm | 9.14.4+ | `pnpm -v` — `corepack enable && corepack install -g pnpm@9.14.4` if missing |
| Chrome stable | latest | `Google Chrome` in /Applications, or `which google-chrome` on Linux |
| Claude Code | latest | The actual `claude` CLI (not this conversation interface). `claude --version`. Authenticated. |
| Cursor / Windsurf / VS Code Copilot | optional | Only needed for the multi-client `peek init` check (peek Group B.5) |
| Playwright | optional | Only needed for the headline-feature check (peek Group J.8). `pnpm dlx playwright --version` is fine. |

### Clean shell (do this first)

The QA walks a fresh-install path. If you've run peek locally before, wipe state first:

```sh
# nuke peek's home + native-host manifests (macOS — adjust paths per OS)
rm -rf ~/.peek
rm -f ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.peekdev.host.json
rm -f ~/Library/Application\ Support/Microsoft\ Edge/NativeMessagingHosts/com.peekdev.host.json

# linux:
# rm -f ~/.config/google-chrome/NativeMessagingHosts/com.peekdev.host.json

# confirm gone
ls -la ~/.peek 2>&1 | head -3            # should say "No such file or directory"
ls ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.peekdev.host.json 2>&1 | head -1
```

Optional: in Claude Code's `~/.claude.json`, remove any existing `mcpServers.peek` entry so you can verify `peek init` writes it correctly. (Back up the file first.)

## Output format

Don't ad-hoc this. Pick one:

1. **Recommended:** copy each `.md` checklist into a private workspace doc (Notion / Obsidian / Linear comment), tick boxes inline as you go, paste short status + notes per item. The Status column at the right of each item is what you fill in.
2. **Per-failure issue:** for any checklist item that fails, `gh issue create --title "QA-T-A1: ..." --body "<paste the item + your repro>"` so a follow-up has a single thread to fix it.

Either way, keep the source `.md` files in the repo unmodified — they're the canonical fresh-start runbook, not your scratch space.

## Findings triage (use these in every "Status" cell)

| Symbol | Meaning | Action |
|---|---|---|
| 🔴 | Showstopper — burns first-install. | Must fix before public flip. Open a P0 issue immediately. |
| 🟡 | Annoyance — confusing but workable. | Fix this week, or open a Phase-5-blocker issue. |
| 🟢 | Polish — works but rough. | Open an issue, defer. |
| ✅ | Pass | No action. |
| ⏸ | Blocked — couldn't run this item. | Note what blocked it and continue. |

## Don't QA these — they're known Phase-5 stubs

Anything in this list returns a known sentinel response. Skip the item or note it as `⏸ Phase-5-stub` in the Status. Surfacing them as bugs would clutter the findings.

| Surface | Stub behavior |
|---|---|
| peek MAIN-world action dispatcher | `execute_action` returns `{ok:false, error:'MAIN-world dispatcher not wired (Phase 3e)'}`. Clicking through Claude WON'T actually click in this build. |
| peek banner UX | `request_authorization` returns a synthetic `panel-closed` — no real Allow/Deny UI yet. |
| peek Level-3 `confirmToken` consume-to-skip-banner | Token is issued but not consumed at the SW boundary. |
| peek allow-list-match approver | Allow-list patterns are parsed but not gated against actions. |
| peek Deep-capture `network.method` | Hardcoded `GET`. Pairing with `requestWillBeSent` merge is Phase 5. |
| peek request-headers persistence | Dropped at host. Schema migration Phase 5. |
| peek `shadow.report` shape | Ack-only — content not persisted. |
| peek signal stubs (a11y / web-vitals / security) | Return `{implemented:false}`. |

Anything else? **It's in scope. If it doesn't do what the docs say it does, that's a finding.**

## Estimated time

- **tracelane** — ~2 hours (Groups A–F; Group D requires Allure install; Group E requires Firefox driver to actually walk)
- **peek** — ~2 hours (Groups A–L; Group J requires Claude Code authenticated; Group J.8 requires Playwright if you want to validate the generated repro)
- **Buffer** — 1 hour for "huh, that's weird" detours

Plan ~half a day total. Both checklists end with a Findings summary template — fill that in, then we triage together before deciding whether to flip the repo public.

## When you're done

Push the *summary* (not the filled-in checklists themselves, unless you want to) to the repo as `docs/qa/findings-2026-05-NN.md` if you want a record, or just paste it into a Linear ticket. Then we decide:

- 0 🔴 + ≤3 🟡 → flip public, proceed to Phase 5 launch
- ≥1 🔴 → fix-list before flipping. **Do not flip with a known showstopper.**
- ≥4 🟡 → triage; some may be polish-class in disguise
