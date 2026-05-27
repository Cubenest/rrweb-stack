import { defineConfig } from 'vitest/config';

// peek-cli is a pure Node CLI (reads ~/.peek/sessions.db, writes MCP-client
// config files). It never touches the DOM, so tests run in the `node`
// environment rather than jsdom.
export default defineConfig({
  test: {
    environment: 'node',
  },
});
