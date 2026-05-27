// Public types for the report builder.

/** Test outcome rendered in the report header + markdown export. */
export type ReportStatus = 'passed' | 'failed' | 'skipped' | 'broken';

/** Recording viewport, surfaced in the metadata header. */
export interface Viewport {
  width: number;
  height: number;
}

/**
 * Metadata for a single test report (P1 PRD §F.1 / §F.3). All fields except
 * `title` and `status` are optional — adapters fill what they can, and CI
 * provenance (commit SHA, build URL) is auto-detected from the environment
 * when omitted (see {@link resolveCiMetadata}).
 */
export interface ReportMeta {
  /** Spec file path, e.g. `test/login.spec.ts`. */
  spec?: string;
  /** Test title, e.g. `logs in with valid credentials`. */
  title: string;
  /** Test outcome. */
  status: ReportStatus;
  /** Failure message, when the test failed/broke. */
  error?: string;
  /** Total test duration in milliseconds. */
  durationMs?: number;
  /** Browser name, e.g. `chrome`. */
  browserName?: string;
  /** Browser version, e.g. `124.0.6367.78`. */
  browserVersion?: string;
  /** Recording viewport. */
  viewport?: Viewport;
  /** Commit SHA. Auto-detected from `GITHUB_SHA` / `CI_COMMIT_SHA` when omitted. */
  commitSha?: string;
  /** CI build URL. Auto-detected from common CI env vars when omitted. */
  buildUrl?: string;
}
