// Type declaration for the JS-only esbuild bundle script so wxt.config.ts (TS)
// can import `buildRecorder` without `tsc` complaining about an implicit-any
// module. The script is `.mjs` (not `.ts`) so it runs under plain Node from the
// WXT build hook + the IIFE-assertion script with no transpile step.

/**
 * Build the MAIN-world recorder into `outFile` as a self-contained IIFE.
 * @param outFile absolute path to write the IIFE bundle to.
 * @returns the `outFile` that was written.
 */
export function buildRecorder(outFile: string): Promise<string>;
