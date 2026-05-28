# tracelane-demo (QA fixture)

A minimal, runnable WebdriverIO project used by [`../../tracelane-qa.md`](../../tracelane-qa.md) Groups A–F.

## Why this isn't inside the monorepo

Run it outside `rrweb-stack/` so pnpm's workspace hoisting doesn't interfere with the install-as-a-real-user simulation. Copy it once:

```sh
cp -r docs/qa/fixtures/tracelane-demo ~/tmp/tracelane-demo
cd ~/tmp/tracelane-demo
```

## Run

```sh
pnpm install
pnpm tsc --noEmit -p tsconfig.json    # parse check (Group A.2)

# Group B — passing test (no report expected):
pnpm wdio run wdio.conf.ts --spec tests/passing.spec.ts
ls tracelane-reports/ 2>/dev/null     # empty / absent

# Group C — failing test (report expected):
pnpm wdio run wdio.conf.ts --spec tests/failing.spec.ts
ls tracelane-reports/                 # one .html file
open tracelane-reports/*.html         # opens the offline replay (macOS)
```

## What `failing.spec.ts` does

1. Navigates to a tiny static fixture page served on `127.0.0.1:0` (random port).
2. Types `hunter2` into a `<input type="password">` (proves masking in C.5).
3. Clicks a button that fires `console.log("[tracelane-demo] button clicked")` AND a `fetch('/api/will-fail')` to a 404 (proves console + network capture).
4. Asserts a value that won't match — test fails on purpose.

Three signal types in one report: rrweb DOM mutations, console log line, failed network call.

## What `passing.spec.ts` does

The same nav + a true assertion. Test passes. **No report** should be written (ADR-0005 failed-only quota gate).

## Pinned versions

The `package.json` pins `webdriverio@^9` and `@tracelane/wdio@^0.1.0-alpha.1` (latest published alpha). If you bump WDIO majors, the fixture's hook signatures may need adjustments — see the @tracelane/wdio README for the version compat note.

## Layout

```
tracelane-demo/
  package.json
  tsconfig.json
  wdio.conf.ts
  page-fixture.html
  tests/
    passing.spec.ts
    failing.spec.ts
```
