# Contributing to rrweb-stack

Thanks for taking the time to contribute. This repo hosts two OSS products
(`tracelane` and `peek`) built on a shared rrweb-based substrate
(`@cubenest/rrweb-core`). The guidelines below keep contributions consistent
across both products.

This is a side project with a single committer; see
[`docs/SUSTAINABILITY.md`](docs/SUSTAINABILITY.md) for the framing and
cadence. We optimise for predictability, not throughput.

## Reporting issues

File issues at <https://github.com/Cubenest/rrweb-stack/issues>. Use one of
the issue templates when available. A good report includes:

- Which product/package (e.g. `@tracelane/core`, `@peekdev/extension`) and
  version (run `npm view <pkg> version` if unsure).
- Environment: OS, Node version, browser/runner version.
- Minimal reproduction (repo link, gist, or inlined code).
- Expected vs. actual behaviour with full stack traces / console output.
- Whether the issue is reproducible from a clean install.

**For security vulnerabilities, do not open a public issue** — see
[`SECURITY.md`](SECURITY.md). The disclosure channel is GitHub Private
Vulnerability Reporting.

## Development setup

### Prerequisites

- **Node.js 24** (see [`.nvmrc`](.nvmrc); `nvm use` will pick the right
  major). The repo `engines.node` floor is `>=22.0.0`, but CI and npm OIDC
  publishing run on Node 24 — develop on 24 to match.
- **pnpm 9.14.4** (pinned via the root `packageManager` field). Use
  Corepack to install the exact version:

```bash
corepack enable
corepack install --global pnpm@9.14.4
```

### First-run

```bash
git clone https://github.com/Cubenest/rrweb-stack.git
cd rrweb-stack
pnpm install
pnpm -r build
pnpm -r test
```

### Common scripts (run from the repo root)

- `pnpm lint` — Biome lint across the workspace.
- `pnpm typecheck` — `tsc --noEmit` across packages.
- `pnpm test` — vitest unit + integration tests.
- `pnpm build` — build all packages.
- `pnpm changeset` — open the changeset wizard for a PR.

Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before
opening a PR. The lefthook pre-commit hook runs Biome `--write` and
`typecheck` on staged files; CI runs the full set.

## Branching

This repo runs a **single-committer side-project posture**. The maintainer
(`harry-harish`) pushes directly to `main` when shipping their own changes;
this is the project's standing direct-to-main authorization, recorded in
[`docs/SUSTAINABILITY.md`](docs/SUSTAINABILITY.md) and the team memory.

External contributors **must** open a PR from a feature branch — direct
pushes by anyone other than the maintainer are rejected by GitHub branch
protection (where configured) and by review policy regardless.

For maintainer or external PRs, use one of:

- `feat/<topic>` — new feature
- `fix/<topic>` — bug fix
- `chore/<topic>` — tooling, build, infra
- `docs/<topic>` — docs-only
- `release/<package>-<version>` — release prep (rare; Changesets bot
  normally owns this)

Keep branch names short, lowercase, hyphen-separated.

## Developer Certificate of Origin (DCO)

**Every commit must be signed off** under the
[Developer Certificate of Origin](https://developercertificate.org/). The
DCO is a developer's statement that they have the right to submit the
contribution under the project's licence; it is *not* a CLA and does not
assign copyright.

Add a `Signed-off-by:` trailer to each commit using `-s`:

```bash
git commit -s -m "feat(tracelane): add console-capture buffer"
```

This produces:

```
Signed-off-by: Your Name <your.email@example.com>
```

The DCO check in CI (`.github/workflows/dco.yml`) will fail any PR with
unsigned commits. Use `git commit --amend -s` or `git rebase --signoff`
to fix existing commits before re-pushing.

### Maintainer git identity for this repo

The maintainer signs off as:

```
Signed-off-by: harry-harish <22562634+harry-harish@users.noreply.github.com>
```

This is the GitHub no-reply form, so the email is stable across address
changes. If you are taking over maintenance, **do not reuse this identity**
— configure your own `user.name` / `user.email` per-repo (`git config
--local user.email <yours>`).

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional-scope>): <short summary>
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`.

Examples:

- `feat(peek): add stdio MCP transport`
- `fix(tracelane): debounce console-capture flush on teardown`
- `docs: update README products table`
- `ci: pin scorecard action to commit SHA`

Use the scope to identify the product or package when relevant
(`tracelane`, `peek`, `rrweb-core`, `peek-mcp`, etc.).

## Changesets

**Every non-docs PR must include a changeset.** From the repo root:

```bash
pnpm changeset
```

Pick the affected packages, the bump type (`patch`, `minor`, `major`),
and write a short summary that will land in the published CHANGELOG.
Commit the generated `.changeset/*.md` file with your changes.

Changes that don't ship to users (internal refactors, tests-only, CI
tweaks, docs-only edits, repo hygiene config like `renovate.json`) do
not need a changeset.

## Workflow security hard rules

These rules exist because the supply-chain threat model is real (see the
PostHog Shai-Hulud 2.0 incident — November 24 2025 — where attackers
compromised a GitHub Action that ran with PR-author-supplied content
under elevated permissions).

1. **No `pull_request_target` triggers in any workflow.** Period. The
   PostHog Shai-Hulud 2.0 incident, and several earlier compromises, all
   leveraged `pull_request_target` running checkout-of-PR-head with
   secrets in scope. PRs from forks run with `pull_request` only, with
   `GITHUB_TOKEN: { contents: read }`.
2. **Every GitHub Action must be pinned to a 40-character commit SHA.**
   Floating tags (`@v4`, `@main`) are forbidden. Renovate keeps these
   updated; see [`renovate.json`](renovate.json).
3. **Workflow `permissions:` must be scoped to the minimum needed.**
   Default at the workflow root is `contents: read`. Jobs that need
   more (release publishing, scorecard SARIF upload) declare it
   explicitly at the job level.
4. **No long-lived publish tokens.** npm publishes use OIDC Trusted
   Publishing — see [`release.yml`](.github/workflows/release.yml).

If your PR adds a workflow, run it against these rules first.

## Pull request process

1. Open a PR against `main`. Fill in the PR template if present.
2. Run local validation: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
3. Add a changeset if required (see above).
4. CI must pass: lint, typecheck, test, build, DCO check.
5. At least one maintainer review is required before merge for
   external PRs. The maintainer may self-merge their own PRs under
   the side-project posture.
6. Maintainers squash-or-merge based on the PR's commit hygiene.
   Keep your branch rebased on `main` to avoid noisy merge commits.

## Code review philosophy

We follow [Greg McQuaid's "robot pedantry, human empathy"](https://about.gitlab.com/blog/code-review-guidelines/)
posture:

- **CI is the pedant.** Mechanical issues — formatting, lint, types,
  tests, DCO — are CI's job. Reviewers do not nitpick a missing
  semicolon Biome already caught.
- **Reviewers focus on design.** Is this the right abstraction? Does
  it match the existing module boundaries (ADR-0001…ADR-0010)? Does
  it carry a clear failure mode? Does it tell a future reader why,
  not just what?
- **Empathy is mandatory.** Be kind. The contributor on the other
  side is donating time. Disagree with proposals, not with people.

## Suggesting a new integration target

Each product caps itself at **5 active first-party integrations** — see
the integration-led GTM posture summarised in
[`docs/SUSTAINABILITY.md`](docs/SUSTAINABILITY.md). The maintainer
tracks integration-slot occupancy in a private operational doc; the
public-side signal is whether the package is published under
`@tracelane/*` or `@peekdev/*` and listed under "Packages" in the root
README.

To propose a new integration:

1. Open a [Discussion](https://github.com/Cubenest/rrweb-stack/discussions)
   tagged `integration-proposal`. Cover: which product, which target
   (e.g. "Cypress for tracelane"), expected user volume, your
   willingness to maintain the bridge package.
2. If accepted, you'll be invited to open a PR adding the package
   under `packages/` following the existing `@tracelane/wdio` shape.
3. If the active-integrations cap is full, the proposal stays in the
   queue until one of the existing five is sunset.

## Issue templates

`.github/ISSUE_TEMPLATE/` contains templates for:

- `bug.yml` — reproducible bug reports.
- `feature.yml` — feature requests.
- `question.yml` — usage questions (often re-routed to Discussions).
- `security-redirect.md` — points reporters to `SECURITY.md` for
  vulnerability disclosure.

Pick the template that matches; if none fit, use the blank issue and
explain why.

## Code of Conduct

By participating in this project you agree to abide by the
[Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## Questions

Open a [Discussion](https://github.com/Cubenest/rrweb-stack/discussions)
for design questions or anything that doesn't fit an issue template.
