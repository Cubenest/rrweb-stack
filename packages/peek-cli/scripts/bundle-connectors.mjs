#!/usr/bin/env node
// Bundle the surface connectors into this package's dist/ so the published CLI
// can spawn them directly — no separate npm install, no monorepo clone, no
// `--local` build. `peek connect add slack` then resolves to
// `node <cli>/dist/connectors/slack.js` (see src/lib/connect/descriptors.ts).
//
// We bundle from SOURCE and alias the workspace connector packages to their
// src entry, so the private `@peekdev/connector-{core,slack}` packages never
// need to be published or pre-built. Only the native keychain module
// (`@napi-rs/keyring`) stays external — it can't be inlined; it's a runtime
// dependency of `@peekdev/cli`, so npm installs its platform binary and the
// bundle resolves it from the CLI's node_modules at spawn time.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url)); // packages/peek-cli/scripts
const cliRoot = dirname(here); // packages/peek-cli
const pkgs = resolve(cliRoot, '..'); // packages/

const connectors = [
  {
    surface: 'slack',
    entry: resolve(pkgs, 'connector-slack/src/index.ts'),
    outfile: resolve(cliRoot, 'dist/connectors/slack.js'),
  },
];

for (const c of connectors) {
  await build({
    entryPoints: [c.entry],
    outfile: c.outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // Native module — cannot be inlined. Declared as a runtime dep of @peekdev/cli.
    external: ['@napi-rs/keyring'],
    // Pull the workspace connector core from source so no dist/publish is needed.
    alias: {
      '@peekdev/connector-core': resolve(pkgs, 'connector-core/src/index.ts'),
    },
    // ESM output for node: provide `require` for any bundled CJS dep interop.
    banner: {
      js: "import { createRequire as __peekCreateRequire } from 'node:module'; const require = __peekCreateRequire(import.meta.url);",
    },
    legalComments: 'none',
    logLevel: 'info',
  });
  console.log(`bundle-connectors: wrote dist/connectors/${c.surface}.js`);
}
