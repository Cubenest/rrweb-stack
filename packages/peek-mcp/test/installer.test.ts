import { describe, expect, it } from 'vitest';
import { type InstallSink, installManifests } from '../src/native-host/installer.js';
import {
  type ExtensionIds,
  buildManifest,
  resolveInstallTargets,
} from '../src/native-host/manifest.js';

const IDS: ExtensionIds = {
  chromeWebStore: 'aaaachromewebstoreidaaaaaaaaaaaa',
  edgeAddons: 'PLACEHOLDER_EDGE_ADDONS_ID',
  dev: 'ccccdevunpackedidcccccccccccccc',
};

const manifest = buildManifest('/opt/peek/peek-mcp', IDS);

/** Recording fake sink so we can assert on writes without touching the OS. */
function fakeSink(): { sink: InstallSink; files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    sink: {
      writeManifestFile(path, contents) {
        files.set(path, contents);
      },
      writeRegistryKey(key, _path, contents) {
        files.set(key, contents);
      },
    },
  };
}

describe('installManifests — dry run (the default postinstall path)', () => {
  it('writes nothing and reports every target as not-written', () => {
    const { sink, files } = fakeSink();
    const targets = resolveInstallTargets('darwin', '/Users/jane');
    const results = installManifests(targets, manifest, { dryRun: true, sink });

    expect(files.size).toBe(0);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.written === false)).toBe(true);
    expect(results.every((r) => r.error === undefined)).toBe(true);
  });
});

describe('installManifests — consented write', () => {
  it('writes the manifest JSON to each macOS path with pretty JSON + trailing newline', () => {
    const { sink, files } = fakeSink();
    const targets = resolveInstallTargets('darwin', '/Users/jane');
    const results = installManifests(targets, manifest, { sink });

    expect(results.every((r) => r.written)).toBe(true);
    expect(files.size).toBe(3);

    const chrome = files.get(
      '/Users/jane/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.cubenest.peek.json',
    );
    expect(chrome).toBeDefined();
    expect(chrome?.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(chrome as string);
    expect(parsed.name).toBe('com.cubenest.peek');
    expect(parsed.type).toBe('stdio');
    expect(parsed.path).toBe('/opt/peek/peek-mcp');
    expect(parsed.allowed_origins).toEqual([
      'chrome-extension://aaaachromewebstoreidaaaaaaaaaaaa/',
      'chrome-extension://ccccdevunpackedidcccccccccccccc/',
    ]);
  });

  it('captures a per-target error and continues past it', () => {
    const targets = resolveInstallTargets('darwin', '/Users/jane');
    let calls = 0;
    const sink: InstallSink = {
      writeManifestFile() {
        calls += 1;
        if (calls === 2) throw new Error('EACCES: permission denied');
      },
      writeRegistryKey() {},
    };
    const results = installManifests(targets, manifest, { sink });

    expect(results[0]?.written).toBe(true);
    expect(results[1]?.written).toBe(false);
    expect(results[1]?.error).toMatch(/EACCES/);
    expect(results[2]?.written).toBe(true); // run continued past the failure
  });
});
