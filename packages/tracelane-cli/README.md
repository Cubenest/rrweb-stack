<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-tracelane.svg" height="40" alt="tracelane">

# @tracelane/cli

> The reporter for your WebdriverIO and Playwright tests — Cypress on the roadmap. Self-contained HTML for every run — replay failures, audit successes, attach to any bug tracker. No SaaS, no dashboard, no signup.

One command to wire tracelane into your WebdriverIO or Playwright project. Detects your runner + package manager, installs the right adapter (`@tracelane/wdio` / `@tracelane/playwright`), edits the runner config in place, creates `tracelane-reports/`, ignores it in git. Idempotent and dry-runnable.

[![npm](https://img.shields.io/npm/v/@tracelane/cli.svg)](https://www.npmjs.com/package/@tracelane/cli)
[![downloads](https://img.shields.io/npm/dw/@tracelane/cli.svg)](https://www.npmjs.com/package/@tracelane/cli)
[![license](https://img.shields.io/npm/l/@tracelane/cli.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![node](https://img.shields.io/node/v/@tracelane/cli.svg)](https://www.npmjs.com/package/@tracelane/cli)
![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

![tracelane init — one command](https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/tracelane-hero.gif)

Docs: <https://tracelane.cubenest.in>

```sh
cd your-wdio-project
npx @tracelane/cli init
```

That's it. `npx @tracelane/cli init` does four things:

1. Detects your runner — WebdriverIO from `wdio.conf.{ts,js,mjs,cjs}` or Playwright from `playwright.config.{ts,js,mjs,cjs}` — and your package manager from your lockfile.
2. Runs the package manager's dev-add for the matching adapter — `@tracelane/wdio` or `@tracelane/playwright` (`pnpm add -D` / `yarn add -D` / `npm install --save-dev` / `bun add -d`).
3. Edits the runner config in place:
   - **WebdriverIO** — adds the `TraceLaneService` import and inserts the service tuple into the `services:` array.
   - **Playwright** — registers the `['@tracelane/playwright', { mode: 'failed' }]` entry in the `reporter` array.
4. Creates `./tracelane-reports/` and appends `tracelane-reports/` to `.gitignore`.

Run your tests. On a failing test you get a self-contained `./tracelane-reports/…html` — open it in any browser, replay the run with [rrweb](https://www.rrweb.io), inspect console + failed-network panels, attach to any bug tracker.

> **Playwright one-time follow-up.** The Playwright recording is driven by tracelane's test **fixture**, and the CLI can't safely rewrite every spec file. After `init`, change your spec imports yourself (recording is then automatic — nothing per-test):
>
> ```diff
> - import { test, expect } from '@playwright/test';
> + import { test, expect } from '@tracelane/playwright/fixture';
> ```
>
> `init` prints this reminder when it finishes.

See the [@tracelane/wdio README](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-wdio) and the [@tracelane/playwright README](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-playwright) for the full options reference.

## Usage

```
npx @tracelane/cli init [options]

Options:
  --runner <name>      Force runner choice (wdio|playwright|cypress).
                       Default: auto-detected from project files.
  --dry-run            Print what would happen; change nothing.
  --yes, -y            Skip the "about to do X, Y, Z - continue?" prompt.
  --skip-install       Don't run the package-manager install command.
                       Useful if you already have the adapter installed.
  --help, -h           Show usage.
```

`--dry-run` prints exactly the steps the run would take (and the conf-edit preview) without modifying anything. Re-running `init` against an already-wired conf is a no-op (idempotent).

## What this is NOT

- Not a test runner. tracelane wires itself **into** WebdriverIO / Playwright; you keep using `npx wdio run wdio.conf.ts` or `npx playwright test`.
- Not a SaaS or cloud uploader. The artifact is a single HTML file on your filesystem.
- Not coupled to the GitHub repo. The CLI only reads + writes files in the directory you ran it from.

## Cypress

Cypress detection works, but the CLI exits 0 with a "not yet supported" message — the `@tracelane/cypress` adapter hasn't been published. When it is, a future bump to `@tracelane/cli` will add the wiring. Progress is [tracked on the issues board](https://github.com/Cubenest/rrweb-stack/issues).

If you have a `wdio.conf.*` and a `playwright.config.*` (and/or a `cypress.config.*`) side by side, detection picks the most-mature match in priority order WDIO > Playwright > Cypress — pass `--runner playwright` (etc.) to override.

## How the config edit works (and what to do if it fails)

For **Playwright**, the editor registers `['@tracelane/playwright', { mode: 'failed' }]` in the `reporter` array of your `playwright.config.*` — creating the array if there isn't one, appending if there is, idempotent on re-run. It does **not** touch your spec files: the second half of the Playwright wiring (swapping the test import to `@tracelane/playwright/fixture`) is a one-time manual step `init` reminds you to do.

For **WebdriverIO**, the editor uses string-based regex to:

The editor uses string-based regex to:

1. Insert `import TraceLaneService from '@tracelane/wdio';` after the last existing `import` line.
2. Append `[TraceLaneService, { mode: 'failed' }]` as the LAST element of the `services:` array. Three shapes are recognized:
   - `services: []` (empty)
   - `services: ['devtools']` (string elements)
   - `services: [['devtools', {}]]` (tuple elements, including multi-line)
3. If no `services:` key exists, insert one at the end of the config object literal.

If the regex doesn't recognize the conf shape (exotic formatting, dynamically constructed config, etc.) the editor **backs out cleanly** — your conf is NEVER corrupted — and prints the snippet to paste manually. The rest of `init` (install, reports dir, .gitignore) still runs.

A backup `wdio.conf.ts.tracelane-init.backup` is written before the edit; on success it's deleted. On the rare post-write sanity-check failure, the original is restored from the backup and the `.backup` is left next to your conf for one-shot inspection.

## Manual install path

If you prefer to wire by hand (e.g. CI scripts, custom configs):

```sh
npm install --save-dev @tracelane/wdio
mkdir -p tracelane-reports
echo "tracelane-reports/" >> .gitignore
```

```ts
// wdio.conf.ts
import TraceLaneService from '@tracelane/wdio';

export const config = {
  // ...your existing config
  services: [[TraceLaneService, { mode: 'failed' }]],
};
```

Both routes produce the same setup. The CLI exists to remove the "edit wdio.conf.ts" step from the README install instructions.

## Versioning + telemetry

Semantic Versioning. Currently `0.1.0-alpha.x` (pre-release; the API + flags may shift before `1.0.0`).

**No telemetry.** The CLI inspects local files only (lockfile presence, conf shape) and spawns the package-manager process you'd have run by hand. Nothing is sent anywhere.

## License

Apache 2.0. Contributions accepted under the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) — sign commits with `git commit -s`. See [CONTRIBUTING.md](https://github.com/Cubenest/rrweb-stack/blob/main/CONTRIBUTING.md) + [SECURITY.md](https://github.com/Cubenest/rrweb-stack/blob/main/SECURITY.md).
