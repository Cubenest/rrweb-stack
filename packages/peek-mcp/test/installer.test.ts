import { describe, expect, it } from 'vitest';
import { type InstallSink, buildRealSink, installManifests } from '../src/native-host/installer.js';
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
function fakeSink(): {
  sink: InstallSink;
  files: Map<string, string>;
  registryWrites: Array<{ key: string; manifestPath: string }>;
} {
  const files = new Map<string, string>();
  const registryWrites: Array<{ key: string; manifestPath: string }> = [];
  return {
    files,
    registryWrites,
    sink: {
      writeManifestFile(path, contents) {
        files.set(path, contents);
      },
      writeRegistryKey(key, manifestPath) {
        registryWrites.push({ key, manifestPath });
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

describe('installManifests — Windows install path (write file + registry pointer)', () => {
  it('writes the manifest JSON AND the registry key pointing at the same path', () => {
    const { sink, files, registryWrites } = fakeSink();
    const targets = resolveInstallTargets('win32', 'C:\\Users\\jane');
    const results = installManifests(targets, manifest, { sink });

    // Both Chrome and Edge targets should write their manifest file +
    // pair-write their registry key.
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.written)).toBe(true);

    expect(files.size).toBe(2);
    expect(registryWrites).toHaveLength(2);

    // Each registry write's manifestPath must match the file just written
    // for the same target.
    for (const w of registryWrites) {
      expect(files.has(w.manifestPath)).toBe(true);
    }
  });

  it('threads the actual manifestPath through to writeRegistryKey (no longer empty string)', () => {
    const { sink, registryWrites } = fakeSink();
    const targets = resolveInstallTargets('win32', 'C:\\Users\\jane');
    installManifests(targets, manifest, { sink });

    expect(registryWrites[0]?.manifestPath).not.toBe('');
    expect(registryWrites[0]?.manifestPath).toMatch(/com\.cubenest\.peek\.json$/);
  });
});

describe('buildRealSink.writeRegistryKey — reg.exe argv shape', () => {
  it('on win32, spawns reg.exe with `add <KEY> /ve /d <PATH> /f`', () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const sink = buildRealSink({
      platform: 'win32',
      execFn: (file, args) => calls.push({ file, args }),
    });
    sink.writeRegistryKey(
      'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.cubenest.peek',
      'C:\\Users\\jane\\AppData\\Local\\Google\\Chrome\\NativeMessagingHosts\\com.cubenest.peek.json',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      file: 'reg.exe',
      args: [
        'add',
        'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.cubenest.peek',
        '/ve',
        '/d',
        'C:\\Users\\jane\\AppData\\Local\\Google\\Chrome\\NativeMessagingHosts\\com.cubenest.peek.json',
        '/f',
      ],
    });
  });

  it('on non-win32 (darwin/linux CI), refuses to fire and throws a clear error', () => {
    const calls: Array<unknown> = [];
    const sink = buildRealSink({ platform: 'darwin', execFn: () => calls.push('did fire') });
    expect(() => sink.writeRegistryKey('HKCU\\Software\\X\\Y', 'C:\\path\\manifest.json')).toThrow(
      /non-Windows platform/,
    );
    expect(calls).toHaveLength(0);
  });

  it('on win32, refuses to fire when manifestPath is missing (defense in depth)', () => {
    const calls: Array<unknown> = [];
    const sink = buildRealSink({ platform: 'win32', execFn: () => calls.push('did fire') });
    expect(() => sink.writeRegistryKey('HKCU\\Software\\X\\Y', '')).toThrow(/manifestPath/);
    expect(calls).toHaveLength(0);
  });

  it('on win32, propagates a spawn failure as the thrown error', () => {
    const sink = buildRealSink({
      platform: 'win32',
      execFn: () => {
        throw new Error('reg.exe failed with code 1');
      },
    });
    expect(() => sink.writeRegistryKey('HKCU\\Software\\X\\Y', 'C:\\x.json')).toThrow(
      /reg\.exe failed/,
    );
  });
});
