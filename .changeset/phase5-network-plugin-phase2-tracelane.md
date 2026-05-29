---
"@tracelane/wdio": minor
"@tracelane/report": minor
"@tracelane/core": minor
---

Wire the @cubenest/rrweb-core network plugin into @tracelane/wdio's
recorder + @tracelane/report's panel extractor.

@tracelane/wdio:
- rrweb-bundle entry now includes getRecordNetworkPlugin alongside
  getRecordConsolePlugin.
- Service registers the network plugin in record() when capture.network
  is true (default). New TraceLaneOptions.capture.networkOptions
  passthrough exposes the plugin's full option surface (recordBody,
  recordHeaders, maskRequestFn, etc.). PostHog-conservative defaults
  (bodies + headers off) inherit through.

@tracelane/report:
- panels.ts gains a branch extracting EventType.Plugin events with
  data.plugin === 'rrweb/network@1'. Maps to the existing NetworkEntry
  shape used by the report's network panel. Old EventType.Custom path
  (tracelane.test.network-error) remains as a fallback for sessions
  recorded with pre-alpha.2 substrate.

@tracelane/core:
- RecorderOptions gains networkPluginOptions (forwarded to the in-page
  rrweb network plugin alongside the existing console plugin). The in-page
  init script registers the plugin only when getRecordNetworkPlugin is
  present on window.rrweb, so older bundles silently skip it.
- Public type NetworkPluginOptions exported.

Closes T-7 from docs/qa/findings-2026-05-28.md — the WDIO-9 CDP-degraded
network capture path no longer matters: the in-page plugin captures
network events directly, framework-agnostic.
