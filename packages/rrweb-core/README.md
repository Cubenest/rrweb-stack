# @cubenest/rrweb-core

[![npm](https://img.shields.io/npm/v/@cubenest/rrweb-core.svg)](https://www.npmjs.com/package/@cubenest/rrweb-core)
[![downloads](https://img.shields.io/npm/dw/@cubenest/rrweb-core.svg)](https://www.npmjs.com/package/@cubenest/rrweb-core)
[![license](https://img.shields.io/npm/l/@cubenest/rrweb-core.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![types](https://img.shields.io/npm/types/@cubenest/rrweb-core.svg)](https://www.npmjs.com/package/@cubenest/rrweb-core)
[![node](https://img.shields.io/node/v/@cubenest/rrweb-core.svg)](https://www.npmjs.com/package/@cubenest/rrweb-core)
![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

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
