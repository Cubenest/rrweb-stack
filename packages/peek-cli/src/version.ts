// CLI version string surfaced by `peek --version` / `peek --help`. Kept as a
// literal (rather than importing package.json — NodeNext + verbatimModuleSyntax
// makes a runtime JSON import awkward, and a stray resolveJsonModule asset in
// dist is avoidable). The release Changeset bumps both this and package.json.
export const CLI_VERSION = '0.1.0-alpha.0';
