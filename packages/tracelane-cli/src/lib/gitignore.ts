// Pure helpers for adding `tracelane-reports/` to a project's .gitignore.
// All file I/O lives in the command shell (init.ts) so we can test the merge
// logic against in-memory strings.

/** The .gitignore entry we add (with a leading explanation comment). */
export const TRACELANE_GITIGNORE_BLOCK =
  '\n# tracelane test-failure replay reports\ntracelane-reports/\n';

/** The bare entry line we look for when deciding "is this already covered?" */
const TRACELANE_GITIGNORE_LINE = 'tracelane-reports/';

/**
 * True if the existing .gitignore content already covers `tracelane-reports/`.
 * Matches the exact line OR an unanchored variant (`tracelane-reports`
 * without the trailing slash) since git treats both the same way for an
 * untracked directory.
 */
export function hasTracelaneEntry(existing: string): boolean {
  for (const raw of existing.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === TRACELANE_GITIGNORE_LINE) return true;
    if (line === 'tracelane-reports') return true;
  }
  return false;
}

/**
 * Produce the new .gitignore content after adding the tracelane entry. If the
 * entry is already present (per `hasTracelaneEntry`), return the input
 * unchanged. Inserts a leading newline if the file is non-empty and doesn't
 * already end with one, so the comment doesn't glue onto a previous entry.
 */
export function mergeGitignore(existing: string): string {
  if (hasTracelaneEntry(existing)) return existing;
  if (existing.length === 0) {
    // Brand-new .gitignore: drop the leading newline.
    return TRACELANE_GITIGNORE_BLOCK.replace(/^\n/, '');
  }
  const sep = existing.endsWith('\n') ? '' : '\n';
  return `${existing}${sep}${TRACELANE_GITIGNORE_BLOCK.replace(/^\n/, '')}`;
}
