import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseDuration } from './duration.js';
import { peekHomeDir } from './peek-home.js';

export interface RetentionPolicy {
  /** Prune sessions older than this duration (e.g. "30d"). Omitted ⇒ no age rule. */
  maxAge?: string;
  /** Evict oldest sessions until the summed on-disk event bytes ≤ this. Omitted ⇒ no disk rule. */
  maxSizeBytes?: number;
  /** Never prune below the N most-recent sessions. Omitted ⇒ no floor. */
  keepLast?: number;
}

const PolicySchema = z
  .object({
    maxAge: z
      .string()
      .refine((s) => {
        try {
          parseDuration(s);
          return true;
        } catch {
          return false;
        }
      }, 'maxAge must be a duration like 30d/1h/7d')
      .optional(),
    maxSizeBytes: z.number().int().nonnegative().optional(),
    keepLast: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Absolute path to the policy file, honoring PEEK_HOME. */
export function retentionPolicyPath(homeDir: string = peekHomeDir()): string {
  return join(homeDir, 'policy.json');
}

/** Read the policy. Fail-safe: missing/malformed/invalid ⇒ null (never throws into a delete path). */
export function loadPolicy(homeDir: string = peekHomeDir()): RetentionPolicy | null {
  const path = retentionPolicyPath(homeDir);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  const parsed = PolicySchema.safeParse(raw);
  return parsed.success ? (parsed.data as RetentionPolicy) : null;
}

/** Validate then persist a policy (throws on invalid input). */
export function savePolicy(policy: RetentionPolicy, homeDir: string = peekHomeDir()): void {
  const validated = PolicySchema.parse(policy);
  writeFileSync(retentionPolicyPath(homeDir), `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
}

/** Remove the policy file (idempotent). */
export function clearPolicy(homeDir: string = peekHomeDir()): void {
  rmSync(retentionPolicyPath(homeDir), { force: true });
}
