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

The fixture also exercises tracelane's advisory security-hygiene layer: the page serves a deliberately insecure `Set-Cookie` (`demo_session=abc123`, no `Secure`/`HttpOnly`/`SameSite`) and includes a `target="_blank"` link with no `rel="noopener"`, so the **insecure-cookie** and **reverse-tabnabbing** signals fire on this local http fixture. The **missing-headers** and **mixed-content** signals are HTTPS-gated and only appear on real HTTPS pages, so they won't show up against the `127.0.0.1` fixture.

## What `passing.spec.ts` does

The same nav + a true assertion. Test passes. **No report** should be written (ADR-0005 failed-only quota gate).

## Pinned versions

The `package.json` pins `webdriverio@^9` and `@tracelane/wdio@^0.1.0-alpha.2` (latest published alpha). If you bump WDIO majors, the fixture's hook signatures may need adjustments — see the @tracelane/wdio README for the version compat note.

## Note on network capture (QA item C.4)

`@tracelane/wdio` captures network **in-page by default** via the `rrweb/network@1` plugin (`capture.network: true`, set in `wdio.conf.ts`) — no CDP, no `@wdio/devtools-service` required, all browsers. So the failing spec's `fetch('/api/will-fail')` IS captured and the replay's **network panel shows a row** for it. Because the fetch is same-origin (the fixture's static server and `/api/will-fail` share the `127.0.0.1:<port>` origin), the in-page plugin can report its status; the panel is **not** empty.

This fixture does NOT register `@wdio/devtools-service` (WDIO 9 has no stable line — it stabilized at v10; see the @tracelane/wdio README "Version compat"). CDP is now only an **optional enhancement** that adds authoritative HTTP status and true no-response failures over the in-page rows. With no devtools-service present, `tracelane` logs once:

```
[tracelane/wdio] network capture unavailable (CDP not attached); degrading to rrweb+console only.
```

This warning is **benign** — it means only the CDP authoritative-status enhancement is unavailable, not that network capture failed. The in-page plugin still populates the network panel. QA item C.4 should be marked ✅ when the DOM replay + console panel show the deliberate `button clicked` line and the network panel shows the `/api/will-fail` row. To additionally validate the CDP authoritative-status path, run a CDP-capable session (e.g. `@wdio/devtools-service@10`).

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
