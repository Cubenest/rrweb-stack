// Public API surface for @tracelane/report.

// The report builder: events + metadata -> self-contained offline HTML string.
export { buildReport } from './build-report.js';
export type { BuildReportOptions } from './build-report.js';

// Report metadata contract (consumed by adapters like @tracelane/wdio).
export type { ReportMeta, ReportStatus, Viewport } from './types.js';

// Disk writer: build the HTML and write it under outDir with a parallel-safe,
// adapter-namespaced filename. Shared by the WDIO and Playwright adapters.
export { reportFileName, slugify, specSlug, writeReport } from './report-writer.js';
export type { WriteReportInput } from './report-writer.js';

// Events blob round-trip (Task 2.9) — useful for re-reading a report's events.
export { decodeEventsBlob, encodeEventsBlob } from './embed.js';

// Console + network panel extraction (Task 2.10).
export {
  extractConsole,
  extractNetwork,
  CONSOLE_PLUGIN,
  NETWORK_EVENT_TAG,
  NETWORK_CONSOLE_PREFIX,
} from './panels.js';
export type { ConsoleEntry, NetworkEntry } from './panels.js';

// CI metadata resolution (Task 2.11).
export { resolveCiMetadata } from './metadata.js';

// Copy-as-Markdown payload (Task 2.12).
export { buildMarkdown, extractActionLog, MAX_CONSOLE_MESSAGES, MAX_ACTIONS } from './markdown.js';
export type { ActionEntry } from './markdown.js';

// Advisory security-hygiene types. The analyzer itself is bundled in privately
// (vendored from the internal @tracelane/security package at build); consumers
// like @tracelane/wdio import these types from here, not from a separate package.
export type { SecurityFinding, Severity, SecuritySignal, Suppression } from './_security/index.js';
