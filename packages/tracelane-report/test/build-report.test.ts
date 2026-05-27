import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import { loadFflateGunzipSource, loadPlayerUmd } from '../src/assets';
import { buildReport } from '../src/build-report';
import { decodeEventsBlob } from '../src/embed';
import type { ReportMeta } from '../src/types';

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
});
