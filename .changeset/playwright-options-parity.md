---
"@tracelane/playwright": minor
---

Close three option-parity gaps with `@tracelane/wdio`:

- **Security opt-out + suppression file.** New `security` option (default `true`,
  env `TRACELANE_SECURITY`) disables both the `[tracelane.sec]` capture and the
  report-side analysis. A `tracelane.security.suppress.json` file in the working
  directory is loaded at report-write time to silence known-acceptable signals
  (missing/malformed file never throws).
- **Capture-channel toggles + network/console masking.** New nested
  `capture: { rrweb, network, console, networkOptions }` plus top-level
  `consolePluginOptions`. `capture.rrweb: false` records nothing and writes no
  report; `capture.console: false` patches no `console.*`. The legacy top-level
  `captureNetwork` still works but is deprecated in favor of `capture.network`.
  Masking options (`capture.networkOptions`, `consolePluginOptions`) bridge to
  the fixture worker as JSON. Env: `TRACELANE_CAPTURE_RRWEB`,
  `TRACELANE_CAPTURE_CONSOLE`, `TRACELANE_NETWORK_OPTIONS`,
  `TRACELANE_CONSOLE_OPTIONS`. Note: function-valued mask props (`maskRequestFn`,
  `maskResponseFn`) cannot cross the worker-process env bridge and are not
  supported via reporter config.
- **Report footer opt-out + drain/cooldown tuning.** New `report: { footer }`
  (env `TRACELANE_FOOTER`), `drainIntervalMs` (env `TRACELANE_DRAIN_INTERVAL_MS`),
  and `cooldownMs` (env `TRACELANE_COOLDOWN_MS`).
