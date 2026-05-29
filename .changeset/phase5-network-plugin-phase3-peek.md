---
"@peekdev/extension": patch
---

Phase 3 of the framework-agnostic network plugin rollout — peek-extension
migrates off its hand-rolled fetch + XHR wrappers to the plugin in
@cubenest/rrweb-core@alpha.2.

@peekdev/extension:
- MAIN-world recorder (recorder-entry.ts) registers getRecordNetworkPlugin
  in record()'s plugins array. Defaults stay conservative (bodies +
  headers off; PerformanceObserver path on) — peek's privacy posture is
  unchanged, and the plugin's default maskRequestFn already pipes through
  redactBody / redactNetworkHeaders / URL-redaction.
- ~168 LOC of net-capture.ts manual fetch + XHR helpers DELETED (the
  file itself is gone). Recorder-entry.ts loses ~140 LOC of the inline
  `window.fetch =` / `XMLHttpRequest.prototype.{open,send,setRequestHeader} =`
  wrapper shim that's now superseded by the plugin.
- SW relay (entrypoints/background.ts + new background/network-plugin-synth.ts)
  gains a synthesizer that converts plugin events (EventType.Plugin /
  'rrweb/network@1') into the existing NetMessage envelope shape,
  double-writing onto the network.append channel so peek-mcp's
  get_session_network_errors MCP tool keeps returning rows for new
  sessions. The synthesizer is marked for removal in alpha.10 when the
  read-path migrates to walk the rrweb event stream directly (the same
  extractor @tracelane/report's panels.ts already uses).

@peekdev/mcp:
- No schema change. The network_events table + the network.append ingest
  handler still take their input from the SW relay's NetMessage
  envelopes — now synthesized from plugin events instead of forwarded
  from the hand-rolled wrappers. The wire shape is preserved by design;
  get_session_network_errors returns identical row shapes for sessions
  captured via plugin vs the legacy fetch+XHR path.

Closes Task #72 (and Task #71, the umbrella framework-agnostic rrweb
network plugin work spanning phase 1 = substrate, phase 2 = tracelane,
phase 3 = peek).
