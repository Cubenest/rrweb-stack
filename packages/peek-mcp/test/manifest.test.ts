import { describe, expect, it } from 'vitest';
import {
  type ExtensionIds,
  MANIFEST_FILENAME,
  NATIVE_HOST_NAME,
  allowedOrigins,
  buildManifest,
  resolveInstallTargets,
} from '../src/native-host/manifest.js';

const REAL_IDS: ExtensionIds = {
  chromeWebStore: 'aaaachromewebstoreidaaaaaaaaaaaa',
  edgeAddons: 'bbbbedgeaddonsidbbbbbbbbbbbbbbbb',
  dev: 'ccccdevunpackedidcccccccccccccc',
};

const PLACEHOLDER_IDS: ExtensionIds = {
  chromeWebStore: 'PLACEHOLDER_CHROME_WEB_STORE_ID',
  edgeAddons: 'PLACEHOLDER_EDGE_ADDONS_ID',
  dev: 'PLACEHOLDER_DEV_UNPACKED_ID',
};

describe('native-host id', () => {
  it('uses the reverse-DNS id com.cubenest.peek (ADR-0009)', () => {
    expect(NATIVE_HOST_NAME).toBe('com.cubenest.peek');
    expect(MANIFEST_FILENAME).toBe('com.cubenest.peek.json');
  });
});

describe('allowedOrigins', () => {
  it('maps each configured id to a chrome-extension:// origin (no wildcards)', () => {
    const origins = allowedOrigins(REAL_IDS);
    expect(origins).toEqual([
      'chrome-extension://aaaachromewebstoreidaaaaaaaaaaaa/',
      'chrome-extension://bbbbedgeaddonsidbbbbbbbbbbbbbbbb/',
      'chrome-extension://ccccdevunpackedidcccccccccccccc/',
    ]);
    for (const o of origins) expect(o).not.toContain('*');
  });

  it('drops placeholder ids (pre-publish install ships no dead origins)', () => {
    expect(allowedOrigins(PLACEHOLDER_IDS)).toEqual([]);
  });

  it('de-duplicates when ids collide (e.g. same dev id reused)', () => {
    const origins = allowedOrigins({
      chromeWebStore: 'sameid000000000000000000000000aa',
      edgeAddons: 'sameid000000000000000000000000aa',
      dev: 'PLACEHOLDER_DEV_UNPACKED_ID',
    });
    expect(origins).toEqual(['chrome-extension://sameid000000000000000000000000aa/']);
  });
});

describe('buildManifest', () => {
  it('produces a stdio manifest with the host id, binary path, and origins', () => {
    const manifest = buildManifest('/usr/local/bin/peek-mcp', REAL_IDS);
    expect(manifest.name).toBe('com.cubenest.peek');
    expect(manifest.type).toBe('stdio');
    expect(manifest.path).toBe('/usr/local/bin/peek-mcp');
    expect(manifest.description).toMatch(/peek/i);
    // Edge id lives in the SAME manifest as Chrome (Edge "first registry
    // location wins" gotcha, P2 PRD §A7).
    expect(manifest.allowed_origins).toContain(
      'chrome-extension://bbbbedgeaddonsidbbbbbbbbbbbbbbbb/',
    );
  });
});

describe('resolveInstallTargets — P2 PRD §A7 path table', () => {
  it('macOS: Chrome + Chromium + Edge under Application Support', () => {
    const targets = resolveInstallTargets('darwin', '/Users/jane');
    const byBrowser = Object.fromEntries(targets.map((t) => [t.browser, t.manifestPath]));
    expect(byBrowser['macOS Chrome']).toBe(
      '/Users/jane/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.cubenest.peek.json',
    );
    expect(byBrowser['macOS Chromium']).toBe(
      '/Users/jane/Library/Application Support/Chromium/NativeMessagingHosts/com.cubenest.peek.json',
    );
    expect(byBrowser['macOS Edge']).toBe(
      '/Users/jane/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.cubenest.peek.json',
    );
  });

  it('Linux: Chrome + Chromium under ~/.config', () => {
    const targets = resolveInstallTargets('linux', '/home/jane');
    const byBrowser = Object.fromEntries(targets.map((t) => [t.browser, t.manifestPath]));
    expect(byBrowser['Linux Chrome']).toBe(
      '/home/jane/.config/google-chrome/NativeMessagingHosts/com.cubenest.peek.json',
    );
    expect(byBrowser['Linux Chromium']).toBe(
      '/home/jane/.config/chromium/NativeMessagingHosts/com.cubenest.peek.json',
    );
  });

  it('Windows: HKCU registry keys for Chrome + Edge', () => {
    const targets = resolveInstallTargets('win32', 'C:\\Users\\jane');
    const byBrowser = Object.fromEntries(targets.map((t) => [t.browser, t.registryKey]));
    expect(byBrowser['Windows Chrome']).toBe(
      'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.cubenest.peek',
    );
    expect(byBrowser['Windows Edge']).toBe(
      'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.cubenest.peek',
    );
    // Registry targets carry no filesystem path.
    expect(targets.every((t) => t.manifestPath === undefined)).toBe(true);
  });

  it('covers all documented install locations across the three OSes', () => {
    // The plan prose rounds to "six paths", but its own enumeration lists seven
    // distinct targets — macOS {Chrome, Chromium, Edge} + Linux {Chrome,
    // Chromium} + Windows {Chrome, Edge} — because Edge needs both a macOS
    // Application-Support dir AND a Windows registry key. We register all seven.
    const darwin = resolveInstallTargets('darwin', '/h').length;
    const linux = resolveInstallTargets('linux', '/h').length;
    const win32 = resolveInstallTargets('win32', 'C:\\h').length;
    expect([darwin, linux, win32]).toEqual([3, 2, 2]);
    expect(darwin + linux + win32).toBe(7);
  });
});
