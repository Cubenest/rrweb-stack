<!--
  The canonical agent-instruction doc for this repo is AGENTS.md — edit there,
  not here. This file exists only because Claude Code reads CLAUDE.md (not
  AGENTS.md); the import below loads the same context so both surfaces stay in
  sync with no duplication. Add Claude-specific notes under a "## Claude Code"
  heading below the import if ever needed.
-->

@AGENTS.md

## Claude Code

### Deploying the docs sites

Both Astro docs sites (`apps/peek-docs` → peek.cubenest.in,
`apps/tracelane-docs` → tracelane.cubenest.in) are deployed to Vercel via CLI.
**Deploy from the monorepo root** — deploying from the app subdirectory only
uploads that directory and leaves workspace deps (`@cubenest/docs-shared`,
`@peekdev/todomvc-demo`) unresolvable on Vercel's build server.

Procedure:

1. Create a temporary `vercel.json` at the repo root (gitignored):

   ```json
   // peek-docs
   {
     "installCommand": "pnpm install --frozen-lockfile",
     "buildCommand": "pnpm --filter peek-docs... run build",
     "outputDirectory": "apps/peek-docs/dist"
   }
   ```

2. Deploy with the project's env vars:

   ```sh
   VERCEL_PROJECT_ID=prj_wbLWp8utBFQXFpIxNC10i5ty5DNo \
   VERCEL_ORG_ID=team_ZKvGQO7dXxGBLl1iJ4vXWwnD \
   vercel --prod
   ```

3. Swap `vercel.json` for tracelane-docs and repeat:

   ```json
   {
     "installCommand": "pnpm install --frozen-lockfile",
     "buildCommand": "pnpm --filter tracelane-docs... run build",
     "outputDirectory": "apps/tracelane-docs/dist"
   }
   ```

   ```sh
   VERCEL_PROJECT_ID=prj_4Lnsk0ODEw2gXUzPPpiz1an8gqzt \
   VERCEL_ORG_ID=team_ZKvGQO7dXxGBLl1iJ4vXWwnD \
   vercel --prod
   ```

4. Delete `vercel.json` and `.vercel/` from the repo root when done.

Why: the `cd ../.. && pnpm install` install command in each app's
`.vercel/project.json` was designed for Vercel Git integration (which clones
the full repo). CLI deploys from a subdirectory upload only that directory,
so the monorepo root is unreachable. Deploying from the root with
`VERCEL_PROJECT_ID` uploads everything (≈15 MB) and `pnpm --filter` runs the
build with correct PATH for `cross-env` and `astro`.

The trailing `...` in `--filter peek-docs...` (and `tracelane-docs...`) is
load-bearing: it builds the docs app **plus its workspace dependencies**
(`@cubenest/docs-shared`, `@peekdev/todomvc-demo`) in topological order first.
A bare `--filter peek-docs run build` only builds the app, so on a cache-cold
Vercel runner `@cubenest/docs-shared/dist` is missing and the Astro build fails
with `Failed to resolve entry for package "@cubenest/docs-shared"`.
