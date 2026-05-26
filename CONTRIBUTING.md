# Contributing to rrweb-stack

Thanks for taking the time to contribute. This repo hosts two OSS products (`tracelane` and `peek`) built on a shared rrweb-based substrate. The guidelines below keep contributions consistent across both products.

## Reporting issues

File issues at https://github.com/Cubenest/rrweb-stack/issues. Use one of the issue templates if available. A good report includes:

- Which product/package (e.g. `@tracelane/core`, `@peek/extension`) and version
- Environment: OS, Node version, browser/runner version
- Minimal reproduction (repo link, gist, or inlined code)
- Expected vs. actual behaviour, with full stack traces / console output
- Whether the issue is reproducible from a clean install

For security vulnerabilities, **do not open a public issue** — see [`SECURITY.md`](SECURITY.md).

## Developer Certificate of Origin (DCO)

Every commit must be signed off under the [Developer Certificate of Origin](https://developercertificate.org/). The DCO is a developer's statement that they have the right to submit the contribution under the project's licence; it is *not* a CLA and does not assign copyright.

Add a `Signed-off-by:` trailer to each commit by using `-s`:

```bash
git commit -s -m "feat(tracelane): add console-capture buffer"
```

This produces a trailer like:

```
Signed-off-by: Jane Doe <jane@example.com>
```

The DCO check in CI will fail any PR with unsigned commits. Use `git commit --amend -s` or `git rebase --signoff` to fix existing commits.

## Development setup

Prerequisites:

- Node.js **>= 20.10.0** (see `.nvmrc`)
- pnpm **9.14.4** via Corepack

```bash
corepack enable
corepack install -g pnpm@9.14.4
git clone https://github.com/Cubenest/rrweb-stack.git
cd rrweb-stack
pnpm install
```

Common scripts (run from the repo root):

- `pnpm lint` — Biome lint across the workspace
- `pnpm typecheck` — `tsc --noEmit` across packages
- `pnpm test` — unit/integration tests
- `pnpm build` — build all packages

Run these before opening a PR.

## Branch naming

Branch off `main`. Use one of:

- `feat/<topic>` — new feature
- `fix/<topic>` — bug fix
- `chore/<topic>` — tooling, build, infra
- `release/<package>-<version>` — release prep branches

Keep branch names short and lowercase, hyphen-separated.

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
- `ci: bump pnpm to 9.14.4`

Use the scope to identify the product or package when relevant (`tracelane`, `peek`, `rrweb-core`, etc.).

## Changesets

Every PR that produces a user-visible change (new feature, bug fix, breaking change, public-API tweak) must include a changeset. From the repo root:

```bash
pnpm changeset
```

Pick the affected packages, the bump type (`patch`, `minor`, `major`), and write a short summary. Commit the generated `.changeset/*.md` file with your changes.

Changes that don't ship to users (internal refactors, tests-only, CI tweaks, docs-only edits) do not need a changeset.

## Pull request process

1. Fork (or branch, if you have write access) from up-to-date `main`.
2. Make your changes; keep PRs focused — one logical change per PR.
3. Run local validation: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
4. Add a changeset if required.
5. Open the PR against `main`. Fill in the PR template if present.
6. CI must pass: lint, typecheck, test, build, DCO check.
7. At least one maintainer review is required before merge.
8. Direct pushes to `main` are not allowed; everything lands via PR.

Maintainers will squash-or-merge based on the PR's commit hygiene. Keep your branch rebased on `main` to avoid noisy merge commits.

## Code of Conduct

By participating in this project you agree to abide by the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## Questions

Open a [Discussion](https://github.com/Cubenest/rrweb-stack/discussions) for design questions or anything that doesn't fit an issue template.
