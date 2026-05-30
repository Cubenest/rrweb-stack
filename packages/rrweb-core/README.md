# @cubenest/rrweb-core

Shared rrweb-based capture substrate. Used by [`tracelane`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-core) and [`peek`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-extension). Not generally intended for direct consumption — depend on a product package instead.

## What's in here

- Vendored PostHog rrweb fork (`@posthog/rrweb@0.0.34`)
- PII masking primitives (selectors + regex bank + body/header redaction)
- Large-DOM throttling defaults (mutation guard, data-URL guard, single-event size cap)
- Shadow DOM adapter
- Screenshot fallback interface
- Network capture abstraction (CDP and `chrome.webRequest` implementations)
- Console capture
- Compression helpers (`fflate`)
- IndexedDB persistence helper
- Compatibility matrix

## Versioning

Independent semver. Breaking changes are coordinated across `tracelane` and `peek` releases.

## License

Apache 2.0. Vendored rrweb fork remains MIT-licensed; see NOTICE.
