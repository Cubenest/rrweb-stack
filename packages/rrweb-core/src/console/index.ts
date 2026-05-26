// Public barrel for the console capture module.
//
// Locked surface per IMPLEMENTATION_PLAN.md Public API contract (line 703):
//
//   export { createConsoleCaptureBuffer, type ConsoleEvent } from './console';
//
// The factory + companion option/buffer types are re-exported so consumers
// can declare-and-pass without reaching into `./buffer` directly.
//
// `getRecordConsolePlugin` is intentionally NOT re-exported from this
// barrel — it's already exported from the package-level `./rrweb` barrel
// (Task 1.2's wiring), and a second re-export would create two import
// paths for the same symbol. Consumers who want the raw plugin import it
// from `@cubenest/rrweb-core`.

export {
  createConsoleCaptureBuffer,
  type ConsoleCaptureBuffer,
  type ConsoleCaptureOptions,
} from './buffer';
export type { BasicConsoleLevel, ConsoleEvent, ConsoleLevel } from './types';
