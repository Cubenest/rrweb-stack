export function assertNodeVersion(version: string): void {
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10);
  if (Number.isNaN(major) || major < 22) {
    throw new Error(`peek connectors require Node 22+, found ${version}`);
  }
}
