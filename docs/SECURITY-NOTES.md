# Pre-publish security review

**Date:** 2026-05-28
**Commit:** Phase 4a (Task 4.5)
**Reviewer:** harry-harish

This is the single root security-notes file for the pre-launch verification gate. If per-package findings ever require their own waiver justification, add a `SECURITY-NOTES.md` inside that package's directory; for the current commit, all findings are at the workspace/transitive level.

## Scope

- `pnpm dlx socket@latest scan create` — Socket security scan
- `pnpm dlx audit-ci@latest --high --package-manager pnpm` — fail on high-or-critical advisories
- `pnpm dlx audit-ci@latest --moderate --package-manager pnpm` — full picture down to moderate

## Socket scan — deferred (no organization token)

`socket scan create` requires a Socket.dev organization API token. The Cubenest org has not yet been provisioned on Socket.dev as of this commit. The unauthenticated CLI rejects `scan create`, `package score`, and the other supply-chain endpoints. Local-CLI alternatives like `socket optimize` and `socket fix` were not run because they mutate dependency manifests and conflict with the pinned pnpm overrides this repo already maintains.

**Plan:** the Socket.dev integration is a Phase 5 (public-launch) task once the repo flips public and the org tier becomes free. Tracked outside this commit; reopens if a high-severity supply-chain advisory lands on a `@cubenest/*`, `@tracelane/*`, or `@peekdev/*` published dependency between now and Phase 5.

## audit-ci — initial run (before remediation)

| Severity | Count |
|----------|------:|
| critical | 0 |
| high     | 2 |
| moderate | 4 |
| low      | 0 |
| info     | 0 |
| total deps | 1147 |

### High-severity findings (both remediated this commit)

#### GHSA-5c6j-r48x-rmvq — `serialize-javascript@6.0.2` RCE via RegExp.flags

- **Path:** `tracelane-wdio > @wdio/mocha-framework@9.27.2 > mocha@10.8.2 > serialize-javascript@6.0.2`
- **Patched in:** `serialize-javascript@7.0.3`
- **Runtime impact:** None — `@wdio/mocha-framework` is a **devDependency** of `@tracelane/wdio`; end users supply their own test framework. `serialize-javascript` is not in the published runtime tree of any `@tracelane/*` package.
- **Action taken:** Added `"serialize-javascript": "^7.0.3"` to root `pnpm.overrides`. Defense-in-depth — eliminates the path even for our local dev tree.

#### GHSA-ph9p-34f9-6g65 — `tmp@0.2.5` path traversal

- **Paths:**
  - `peek-extension > @wxt-dev/module-react@1.2.2 > wxt@0.20.26 > web-ext-run@0.2.4 > tmp@0.2.5`
  - `peek-extension > wxt@0.20.26 > web-ext-run@0.2.4 > tmp@0.2.5`
- **Patched in:** `tmp@0.2.6`
- **Runtime impact:** None — `wxt` is the WebExtension **build tool**; the produced `.output/chrome-mv3/` extension bundle is what ships, and it does not include `tmp`. The vulnerability is only relevant at build time, which is run by maintainers in trusted environments.
- **Action taken:** Added `"tmp": "^0.2.6"` to root `pnpm.overrides`. Defense-in-depth.

### Post-remediation audit-ci run

```
critical: 0  high: 0  moderate: 3  low: 0  info: 0
total deps: 1146
```

`audit-ci --high` exits 0. ✅

## audit-ci — moderate findings (waived, dev-only)

The three remaining moderate findings are all **dev-only transitives** in build tooling. They are documented here as written waivers because the `--high` threshold is the publish gate per the implementation plan.

| Advisory | Package | Path | Waiver justification |
|---|---|---|---|
| GHSA-4w7w-66w2-5vf9 | `vite@5.4.21` | root `vitest@2 → vite@5` | Tracked separately under tech-debt: bump repo to `vitest@3` / `vite@6` to drop the cross-major override block (see internal task #38). Vitest is a devDependency; not shipped. |
| GHSA-67mh-4wv8-2f99 | `esbuild@0.21.5` | root `vitest@2 → vite@5 → esbuild@0.21.5` | Same upstream chain as above; resolves with the vitest 3 / vite 6 bump. |
| GHSA-w5hq-g745-h8pq | `uuid@8.3.2` | `peek-extension > wxt → web-ext-run → node-notifier → uuid@8.3.2` | Dev-only build tool. The `node-notifier` advisory chain is two levels deep inside `wxt`'s `web-ext-run` dependency; pinning forward requires a `wxt` minor bump (out of scope for Phase 4a). Re-test after the next `wxt` release. |

None of these are reachable in the runtime of any published package.

## Re-run convention

Before each release that updates runtime dependencies, re-run:

```bash
pnpm dlx audit-ci@latest --high --package-manager pnpm
```

If a new high-or-critical lands inside a runtime path of a published package, treat it as a blocker; either bump the affected workspace package or add a `pnpm.overrides` entry with a CVE-citing comment alongside this file.

## Source

Authored as part of the pre-publish security review (Phase 4a). Maintainer-private planning tracks the underlying tasks.
