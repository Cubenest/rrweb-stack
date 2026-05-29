import { defineConfig } from 'vitest/config';

// tracelane-cli is a pure Node CLI (detects runner files in cwd, edits a
// wdio.conf, spawns the package-manager install). It never touches the DOM,
// so tests run in the `node` environment rather than jsdom.
export default defineConfig({
  test: {
    environment: 'node',
  },
});
