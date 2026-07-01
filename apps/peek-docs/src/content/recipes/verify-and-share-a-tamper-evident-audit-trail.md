---
title: "Verify and share a tamper-evident audit trail"
lede: "When an agent has been acting in my browser, I want proof that the audit log is intact before I share it with a colleague or attach it to a bug report."
description: "Use verify_audit_log to confirm the audit hash chain is intact, then bundle and share portable tamper-evident evidence with peek audit bundle."
type: short
status: published
publishedAt: 2026-07-01
integrations: [claude-code, cli]
relatedRecipes: [use-peek-with-per-action-approval, triage-console-errors-from-a-recorded-session, generate-playwright-repro-from-real-browser-session]
---

## What you'll end up with

A verified `*.peekaudit` archive — a portable, self-contained evidence file that any colleague can inspect offline. The archive embeds the audit log, a SHA-256 integrity manifest, and the head hash used for truncation detection. The agent can verify the chain before bundling; the recipient verifies both the archive integrity and the chain after unwrapping.

## Prerequisites

- Claude Code with peek wired in (`peek init` adds the MCP entry to `~/.claude.json`)
- Chrome with the **peek** extension installed — from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb)
- At least one action (`execute_action` or `request_authorization`) already logged — run `peek audit log` to confirm entries exist

See [Set up peek with Claude Code](/recipes/set-up-peek-with-claude-code) for the full setup.

## Steps

### 1. Ask the agent to verify the audit chain

> Before I share the audit log, verify that peek's local audit chain is intact.

The agent calls `verify_audit_log`. It reads `~/.peek/audit.log` and recomputes the SHA-256 hash chain from scratch, comparing each `prevHash` link and checking the `audit.head.json` sidecar for truncation. You get back a status and an entry count, e.g.:

```
status: intact
entries: 42
message: "Hash chain verified — all 42 entries link correctly and the head matches."
```

Other possible statuses: `broken` (a mid-chain hash mismatch), `truncated` (head doesn't match the last entry), `tail-tampered`, `prefix-tampered`, `gaps`, `incomplete-final`, or `head-missing`. If the status is anything other than `intact`, investigate before sharing.

### 2. Bundle the audit log for sharing

```bash
peek audit bundle
```

This creates a `*.peekaudit` archive (a zip with a SHA-256 integrity manifest) in the current directory. The command prints the output filename, e.g. `peek-audit-2026-07-01T12-00-00.peekaudit`.

To write to a specific path:

```bash
peek audit bundle --out /tmp/my-session-audit.peekaudit
```

### 3. Share the archive

Send the `*.peekaudit` file to your colleague, attach it to the bug report, or store it alongside the session recording.

### 4. Recipient verifies the archive

On the receiving end:

```bash
peek audit verify --bundle ./peek-audit-2026-07-01T12-00-00.peekaudit
```

This checks two things:

1. **Archive integrity** — every file's SHA-256 matches the embedded manifest (detects corruption or tampering in transit).
2. **Hash chain** — recomputes the JSONL chain and confirms every `prevHash` link is valid.

A clean result looks like:

```
Archive integrity: OK
Hash chain: intact (42 entries)
```

## Trust & data handling

Local-first: peek uploads nothing — what your MCP client does with the data is up to you.

The audit log records every `execute_action` and `request_authorization` call — including denied ones — with a `seq` counter and a `prevHash` SHA-256 link. The `audit.head.json` sidecar records the tail hash so truncation is detectable.

The log is **tamper-evident, not tamper-proof** — SHA-256 integrity, no signature, no external timestamp. It detects corruption, truncation, and reordering; it does not prevent a determined attacker who can recompute the chain from scratch. For high-stakes evidence (legal, compliance), pair this with an external timestamp anchor.
