// Log-path helpers for `peek connect` daemon log files.
// Task 7 introduces the paths; Task 9 (peek connect logs) extends this module
// with streaming / rotation utilities.

import { join } from 'node:path';
import { peekHomeDir } from '../peek-home.js';

/** Absolute path to the supervisor process log: `~/.peek/connect/supervisor.log`. */
export function supervisorLogPath(): string {
  return join(peekHomeDir(), 'connect', 'supervisor.log');
}

/** Absolute path to a per-connector log: `~/.peek/connect/logs/<name>.log`. */
export function connectorLogPath(name: string): string {
  return join(peekHomeDir(), 'connect', 'logs', `${name}.log`);
}
