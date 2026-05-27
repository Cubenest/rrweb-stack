import vm from 'node:vm';
import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import { loadFflateGunzipSource, loadPlayerUmd } from '../src/assets';
import { buildReport } from '../src/build-report';
import { decodeEventsBlob } from '../src/embed';
import type { ReportMeta } from '../src/types';

/** All inline <script> bodies, in document order. */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
}

function sampleEvents(): eventWithTime[] {
  return [
    { type: EventType.Meta, data: { href: 'http://x/', width: 800, height: 600 }, timestamp: 100 },
    { type: EventType.FullSnapshot, data: { node: { id: 1 }, initialOffset: {} }, timestamp: 200 },
    { type: EventType.IncrementalSnapshot, data: { source: 2 }, timestamp: 300 },
  ] as unknown as eventWithTime[];
}

const META: ReportMeta = {
  spec: 'test/login.spec.ts',
  title: 'logs in with valid credentials',
  status: 'failed',
  error: 'expected element to be visible',
  durationMs: 4210,
  browserName: 'chrome',
  browserVersion: '124.0',
  viewport: { width: 1280, height: 720 },
  commitSha: 'abc1234',
  buildUrl: 'https://ci.example/run/42',
};

/** Pull the embedded EVENTS_GZ_B64 string literal back out of the HTML. */
function extractBlob(html: string): string {
  const m = html.match(/const EVENTS_GZ_B64\s*=\s*"([A-Za-z0-9+/]*={0,2})"/);
  if (!m || m[1] === undefined) throw new Error('EVENTS_GZ_B64 not found in report HTML');
  return m[1];
}

describe('buildReport — self-contained HTML (Task 2.9)', () => {
  it('returns a complete HTML document', () => {
    const html = buildReport(sampleEvents(), META);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('<section id="player"');
  });

  it('embeds the events as a base64-gzip blob that round-trips to the input', () => {
    const events = sampleEvents();
    const html = buildReport(events, META);
    const blob = extractBlob(html);
    expect(blob.length).toBeGreaterThan(0);
    expect(decodeEventsBlob(blob)).toEqual(events);
  });

  it('inlines the rrweb-player UMD and the fflate decompressor (offline)', () => {
    const html = buildReport(sampleEvents(), META);
    // The whole player UMD body is present (not a <script src>).
    expect(html).toContain(loadPlayerUmd());
    expect(html).toContain(loadFflateGunzipSource());
    expect(html).not.toMatch(/<script[^>]+src=/);
    // The bootstrap instantiates the player and decompresses via fflate.
    expect(html).toContain('new rrwebPlayer(');
    expect(html).toContain('gunzipSync');
  });

  it('embeds a META object reflecting the report metadata', () => {
    const html = buildReport(sampleEvents(), META);
    expect(html).toContain('const META =');
    expect(html).toContain('logs in with valid credentials');
  });

  it('escapes </script> in embedded JSON so the inline script cannot be broken out of', () => {
    const evil: ReportMeta = { ...META, title: 'pwn </script><script>alert(1)</script>' };
    const html = buildReport(sampleEvents(), evil);
    // No raw closing-script sequence from our injected payload.
    expect(html).not.toContain('</script><script>alert(1)');
  });

  it('emits four syntactically valid inline scripts (fflate, player, data, bootstrap)', () => {
    // Guards against an edit silently breaking the in-page JS, which unit tests
    // of the HTML string otherwise wouldn't catch (we don't render live DOM).
    const html = buildReport(sampleEvents(), { ...META, error: '</script> oops' });
    const scripts = inlineScripts(html);
    expect(scripts).toHaveLength(4);
    // Each compiles as valid JS.
    for (const src of scripts) expect(() => new vm.Script(src)).not.toThrow();
  });

  it('the embedded data-consts script evaluates and preserves the payloads', () => {
    const html = buildReport(sampleEvents(), { ...META, error: '</script><script>x' });
    const dataScript = inlineScripts(html)[2] ?? '';
    const sandbox: Record<string, unknown> = { atob, btoa };
    vm.createContext(sandbox);
    new vm.Script(
      `${dataScript}\n;globalThis.__r = { META, EVENTS_GZ_B64, CONSOLE, NETWORK, MARKDOWN };`,
    ).runInContext(sandbox);
    const r = sandbox.__r as {
      META: ReportMeta;
      EVENTS_GZ_B64: string;
      MARKDOWN: string;
    };
    expect(r.META.title).toBe(META.title);
    // The </script> in the error survived as data (breakout neutralised, not lost).
    expect(r.META.error).toBe('</script><script>x');
    expect(typeof r.EVENTS_GZ_B64).toBe('string');
    expect(typeof r.MARKDOWN).toBe('string');
  });
});
