# tracelane manual QA — fresh-install walk

Read [`README.md`](./README.md) first. Use the runnable fixture at [`fixtures/tracelane-demo/`](./fixtures/tracelane-demo/) — copy it somewhere outside the monorepo first (`cp -r docs/qa/fixtures/tracelane-demo ~/tmp/tracelane-demo && cd ~/tmp/tracelane-demo`). pnpm hoist rules will fight you if you run inside the workspace.

Default `outDir` is `./tracelane-reports/` (NOT `./tracelane/` — older spec drafts say `tracelane/`, the implementation says `tracelane-reports/`). Filenames look like `<spec>--<title>--<cid>-<ts>.html`.

Conventions for Status:

- ✅ Pass · 🔴 Showstopper · 🟡 Annoyance · 🟢 Polish · ⏸ Blocked/Phase-5-stub

---

## Group A — Fresh install (canonical onboarding)

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| A.1 | Packages resolve | In the fixture dir: `pnpm install`. **Expected:** all packages resolve. No peer-dep warnings about `@wdio/types` or `webdriverio` (they're peerDeps; the fixture's package.json declares them as devDeps). | |
| A.2 | wdio.conf.ts parses | `pnpm exec tsc --noEmit -p tsconfig.json`. **Expected:** zero TS errors. Read the fixture's wdio.conf.ts — confirm `services` includes `TraceLaneService` and `mode` is `'failed'`. | |
| A.3 | Allure dev-dep optional | If you want to walk Group D too: `pnpm add -D @wdio/allure-reporter allure-commandline`. Otherwise skip. | |

## Group B — Passing test = no report (failed-only quota gate per ADR-0005)

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| B.1 | Passing spec writes nothing | `pnpm wdio run wdio.conf.ts --spec tests/passing.spec.ts`. Test passes. **Expected:** `ls tracelane-reports/ 2>/dev/null` shows nothing (or directory doesn't exist). The whole point: **zero report overhead on green tests.** | |
| B.2 | No state leaked outside outDir | `ls ~/.tracelane 2>/dev/null` — should not exist. `find . -name 'tracelane*.html' -not -path './node_modules/*'` — empty. | |

## Group C — Failing test = single self-contained HTML report

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| C.1 | Failing spec writes a report | `pnpm wdio run wdio.conf.ts --spec tests/failing.spec.ts`. Test fails (deliberately). **Expected:** `ls tracelane-reports/` shows exactly one `.html` file. Name format `<spec>--<title>--<cid>-<ts>.html`. | |
| C.2 | Size cap (ADR-0005, Task 2.17) | `du -h tracelane-reports/*.html`. **Expected:** well under 25 MB. (Typical fixture run: 200 KB – 2 MB.) | |
| C.3 | Self-loading | `open tracelane-reports/*.html` (macOS) or `xdg-open` (Linux). The page loads without external script/css. **Expected:** no broken images, no console errors about CORS or 404s in the report's iframe. | |
| C.4 | Replay actually works | Click play / drag the scrubber. **Expected:** DOM evolves — the input typed, the button clicked. Open the console panel → see the deliberate `console.log("[tracelane-demo] button clicked")`. **Note on the network panel:** under WDIO 9 the fixture's network panel is empty (no `@wdio/devtools-service@9` stable; `tracelane/wdio` logs `network capture unavailable (CDP not attached); degrading to rrweb+console only`). Mark ✅ if DOM + console panels work; the empty network panel is the documented graceful-degrade. See `docs/qa/fixtures/tracelane-demo/README.md` "Note on network capture". | |
| C.5 | Password masking | The fixture types into `<input type="password" id="pw">`. In the replay, scrub to that moment. **Expected:** the rendered input shows masked characters (•••• or `*****`), NOT the raw value `hunter2`. | |
| C.6 | Offline | Disable Wi-Fi (`networksetup -setairportpower en0 off` on macOS) and reopen the report file. **Expected:** still loads, still replays. Re-enable when done. | |

## Group D — Allure attach mode

Only run this group if you installed `@wdio/allure-reporter` in A.3.

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| D.1 | Allure reporter wired | Add `'allure'` to the `reporters` array in `wdio.conf.ts`. Re-run `pnpm wdio run wdio.conf.ts --spec tests/failing.spec.ts`. **Expected:** `ls ./allure-results/` is populated. | |
| D.2 | Allure UI loads | `pnpm dlx allure generate ./allure-results --clean && pnpm dlx allure open`. Browser opens to the Allure dashboard. | |
| D.3 | rrweb is attached | Click into the failed test → "Attachments" tab. **Expected:** an `rrweb.html` (or similar) attachment is listed. **Note: this is the v1.1 Allure shim per the @tracelane/wdio README — if `allure: false` (the default), the attach pathway may no-op.** Flag as `⏸ Phase-5-stub` if no attachment appears AND the option is no-op'd. | |
| D.4 | Attached report plays | Click the attachment. **Expected:** opens the same self-contained replay from C.3. | |

## Group E — Compatibility

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| E.1 | Firefox graceful degrade | Edit `wdio.conf.ts` → set `capabilities[0].browserName = 'firefox'`. Install geckodriver if missing: `pnpm add -D geckodriver`. Re-run C.1. **Expected:** the test fails. A report is still written. CDP is Chromium-only, so the one-shot `console.warn` from `@tracelane/wdio` should fire ("CDP unavailable; falling back to rrweb + console only" or similar). **NOT expected:** a crash. | |
| E.2 | Safari (optional) | If `safaridriver` is installed: `browserName: 'safari'`. Same expectation as E.1 — degrade, don't crash. Skip with ⏸ if no Safari driver. | |
| E.3 | WDIO 9 vs 8 | `cat node_modules/webdriverio/package.json \| grep '"version"'`. **Expected:** `9.x`. (The fixture pins to `^9.0.0`; older WDIO 8 has a different `services` hook signature and is not supported.) | |

## Group F — Edge cases

| # | Item | Setup → Expected | Status |
|---|---|---|---|
| F.1 | Timeout, no assertion | Add `tests/timeout.spec.ts` (copy `failing.spec.ts` and replace the failing assertion with `await browser.pause(60_000)`; set Mocha `timeout: 5000` in wdio.conf.ts so it times out). Run. **Expected:** report still written. | |
| F.2 | Throw in `before` hook | Add a spec where the `before()` block throws. **Expected:** the run fails gracefully; no native crash. Whether a report is written for hook failures is implementation-defined — note actual behavior. | |
| F.3 | SPA navigation | Add `tests/spa.spec.ts` that does 3 `browser.url(...)` calls in sequence then fails. **Expected:** replay preserves all three "pages" worth of DOM mutations, not just the last. (This is the rrweb re-injection guard, ADR-0006 + the README's "re-injecting on navigation" note.) | |

---

## Findings summary

Fill this in at the end.

| Bucket | Count | Items |
|---|---|---|
| ✅ Pass | | |
| 🔴 Showstopper | | |
| 🟡 Annoyance | | |
| 🟢 Polish | | |
| ⏸ Blocked / Phase-5-stub | | |

**Top showstoppers (must fix before public flip):**

1. _(none / list IDs)_

**Top annoyances (fix this week):**

1. _(none / list IDs)_

**Defer to Phase 5:**

1. _(list IDs)_

**Overall verdict:** ☐ Ship · ☐ Hold for fixes · ☐ Hold for design review
