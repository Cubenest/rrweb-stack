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
  // Capture the FULL quoted value (any non-quote chars), then assert it is
  // strict base64 — so if the encoder ever emitted URL-safe base64 (-/_) this
  // throws loudly instead of silently matching a truncated prefix (false green).
  const m = html.match(/const EVENTS_GZ_B64\s*=\s*"([^"]*)"/);
  if (!m || m[1] === undefined) throw new Error('EVENTS_GZ_B64 not found in report HTML');
  const blob = m[1];
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(blob)) {
    throw new Error(`EVENTS_GZ_B64 is not strict base64: ${blob.slice(0, 32)}…`);
  }
  return blob;
}

describe('buildReport — self-contained HTML (Task 2.9)', () => {
  it('returns a complete HTML document', () => {
    const html = buildReport(sampleEvents(), META);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('<section id="player"');
  });

  it('builds a valid report from zero events without throwing', () => {
    // Realistic: a test that crashes before rrweb records anything. Exercises
    // the zero-event path through pruneToSizeBudget / extractConsole /
    // extractNetwork / encodeEventsBlob all at once.
    const minimalMeta: ReportMeta = { title: 'crashed early', status: 'failed' };
    let html = '';
    expect(() => {
      html = buildReport([], minimalMeta);
    }).not.toThrow();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('crashed early');
    // The empty blob still round-trips to an empty array.
    expect(decodeEventsBlob(extractBlob(html))).toEqual([]);
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
    // Select by content (not position) so a change in <script> ordering can't
    // silently point this at the wrong block.
    const dataScript = inlineScripts(html).find((s) => s.includes('const META'));
    if (dataScript === undefined) throw new Error('data-consts script not found');
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

describe('buildReport — self-marketing footer (Phase 5 indirect virality)', () => {
  it('renders a footer linking to the Cubenest/rrweb-stack repo with UTM tags', () => {
    const html = buildReport(sampleEvents(), META);
    // Footer element exists, links to the install path (tracelane-wdio dir),
    // and carries the three UTM params for downstream click attribution.
    expect(html).toContain('<footer');
    expect(html).toContain(
      'https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-wdio',
    );
    expect(html).toContain('utm_source=tracelane-report');
    expect(html).toContain('utm_medium=html-footer');
    expect(html).toContain('utm_campaign=indirect-virality');
    // Security: shared widely, never trust the click target.
    expect(html).toMatch(/rel="noopener"/);
    // Closes before </body>.
    expect(html).toMatch(/<\/footer>\s*<\/body>/);
  });

  it('positions the footer AFTER the <main> replay content (not above it)', () => {
    const html = buildReport(sampleEvents(), META);
    const mainCloseIdx = html.indexOf('</main>');
    const footerOpenIdx = html.indexOf('<footer');
    expect(mainCloseIdx).toBeGreaterThan(-1);
    expect(footerOpenIdx).toBeGreaterThan(-1);
    expect(footerOpenIdx).toBeGreaterThan(mainCloseIdx);
  });

  it('keeps the footer non-intrusive (inline muted style, no external assets)', () => {
    const html = buildReport(sampleEvents(), META);
    // The footer line itself uses inline styles (offline, no external CSS).
    const footerMatch = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/);
    expect(footerMatch).not.toBeNull();
    const footerHtml = footerMatch?.[0] ?? '';
    // Muted color (Tailwind gray-500 family) — visible but never grabs focus.
    expect(footerHtml).toContain('#6b7280');
    // No <script>, <link>, or remote asset reference inside the footer.
    expect(footerHtml).not.toMatch(/<script/);
    expect(footerHtml).not.toMatch(/<link/);
    // The href is the only outbound URL in the footer.
    const urls = footerHtml.match(/https?:\/\/[^\s"']+/g) ?? [];
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('github.com/Cubenest/rrweb-stack');
  });
});
