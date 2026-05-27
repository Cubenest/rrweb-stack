import { defineConfig } from 'vitest/config';

// peek-mcp is a pure Node package (native messaging host + SQLite + MCP stdio
// server). It never touches the DOM, so the tests run in the `node`
// environment rather than jsdom.
export default defineConfig({
  test: {
    environment: 'node',
  },
});
