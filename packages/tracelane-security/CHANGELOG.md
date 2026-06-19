# @tracelane/security

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies [69cd9c1]
- Updated dependencies [db8d39b]
  - @cubenest/rrweb-core@0.1.0-alpha.7

## 0.1.0-alpha.1

### Minor Changes

- b688e07: Add an advisory, low-false-positive security-hygiene layer. A new `@tracelane/security` analyzer surfaces missing security headers, mixed content, insecure cookies, and reverse-tabnabbing as a collapsed "Security hygiene (advisory)" panel in the report and in the Copy-as-Markdown-for-AI output. On by default; disable with `security: false`; suppress findings via `tracelane.security.suppress.json`. Advisory only — not a security audit/scan. Capture is privacy-safe (security-header presence + cookie flags, never values).

### Patch Changes

- b688e07: Fix: deliver `[tracelane.sec]` main-document response metadata via a Node-side
  rrweb Custom event instead of a page `console.error`.

  The advisory security layer surfaced main-document response metadata (security-
  header presence + cookie flags) by having `attachNetworkCapture` call a page
  `console.error('[tracelane.sec] ' + json)`. The main-document response fires at
  navigation time, and that page `console.error` raced rrweb's per-navigation
  re-injection — it landed outside the console plugin's recording window and was
  lost. As a result the `missing-security-header`, `insecure-cookie`, and
  `mixed-content` findings never fired end-to-end (only the pure-DOM
  `reverse-tabnabbing` worked).

  The capture layer now delivers the meta Node-side through a new
  `onSecurityMeta` callback on `attachNetworkCapture`; the adapters wire it to
  `recorder.addCustomEvent('tracelane.sec', meta)`, appending the meta directly to
  the recorder's Node buffer as an rrweb Custom event (immune to navigation
  timing). `@tracelane/security`'s `scrapeResponseMeta` now reads
  `EventType.Custom` events (tag `tracelane.sec`) instead of console lines. The
  privacy invariant is unchanged: names + flags only, never header or cookie
  values.
