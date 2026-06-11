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
    // Phase 6: the player mount target is now a <div id="player"> nested inside
    // a <section class="replay">. The id is the meaningful contract — that's
    // what the bootstrap script's getElementById looks for.
    expect(html).toMatch(/<div\s+id="player"/);
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

describe('buildReport — advisory security analysis (Task 11)', () => {
  /**
   * A `tracelane.sec` response-metadata rrweb Custom event, built the same way
   * the capture layer injects it (Node-side, payload = the meta object).
   * `scrapeResponseMeta` reads it back.
   */
  function secEvent(meta: unknown): eventWithTime {
    return {
      type: EventType.Custom,
      timestamp: 0,
      data: { tag: 'tracelane.sec', payload: meta },
    } as unknown as eventWithTime;
  }

  // HTTPS main document with no security headers → a missing-security-header
  // finding flows all the way through analyze() → markdown + panel.
  const insecureMeta = {
    url: 'https://app.test/',
    status: 200,
    isMainDocument: true,
    presentSecurityHeaders: [],
    setCookies: [],
  };

  function eventsWithSecFinding(): eventWithTime[] {
    return [...sampleEvents(), secEvent(insecureMeta)];
  }

  it('renders the advisory panel + markdown section when analysis finds something (default on)', () => {
    const html = buildReport(eventsWithSecFinding(), META);
    // HTML panel marker present.
    expect(html).toContain('id="pane-security"');
    expect(html).toContain('id="tab-security"');
    // Markdown-for-AI carries the advisory section.
    const dataScript = inlineScripts(html).find((s) => s.includes('const MARKDOWN'));
    if (dataScript === undefined) throw new Error('data-consts script not found');
    expect(dataScript).toContain('## Security hygiene (advisory)');
  });

  it('emits neither the panel nor the markdown section when security is false', () => {
    const html = buildReport(eventsWithSecFinding(), META, { security: false });
    expect(html).not.toContain('id="pane-security"');
    expect(html).not.toContain('id="tab-security"');
    expect(html).not.toContain('## Security hygiene (advisory)');
  });

  it('omits the panel + section when analysis finds nothing (no zero-state)', () => {
    // No [tracelane.sec] events at all → no findings → additive layer omitted.
    const html = buildReport(sampleEvents(), META);
    expect(html).not.toContain('id="pane-security"');
    expect(html).not.toContain('## Security hygiene (advisory)');
    // The SECURITY payload is still embedded (as an empty array).
    expect(html).toContain('const SECURITY = [];');
  });
});

describe('buildReport — accessibility (audit A-7)', () => {
  it('wires aria-selected + aria-controls on tabs and aria-labelledby on panes', () => {
    const html = buildReport(sampleEvents(), META);
    // Console tab is the initially-active one → aria-selected="true".
    expect(html).toMatch(
      /<button class="tab active"[^>]*id="tab-console"[^>]*aria-selected="true"[^>]*aria-controls="pane-console"/,
    );
    // The other three tabs are aria-selected="false" and control their panes.
    expect(html).toMatch(
      /id="tab-network"[^>]*aria-selected="false"[^>]*aria-controls="pane-network"/,
    );
    expect(html).toMatch(
      /id="tab-actions"[^>]*aria-selected="false"[^>]*aria-controls="pane-actions"/,
    );
    expect(html).toMatch(
      /id="tab-timeline"[^>]*aria-selected="false"[^>]*aria-controls="pane-timeline"/,
    );
    // Each tabpanel is labelled by its tab.
    expect(html).toContain('id="pane-console" role="tabpanel" aria-labelledby="tab-console"');
    expect(html).toContain('id="pane-network" role="tabpanel" aria-labelledby="tab-network"');
    expect(html).toContain('id="pane-actions" role="tabpanel" aria-labelledby="tab-actions"');
    expect(html).toContain('id="pane-timeline" role="tabpanel" aria-labelledby="tab-timeline"');
    // The tab-switch handler updates aria-selected, not just .active.
    expect(html).toContain("setAttribute('aria-selected'");
  });

  it('makes time-synced rows keyboard-operable (role=button, tabindex, keydown seek)', () => {
    const html = buildReport(sampleEvents(), META);
    // Row markup (in the bootstrap) sets role=button + tabindex + an aria-label.
    expect(html).toContain("setAttribute('role', 'button')");
    expect(html).toContain("setAttribute('tabindex', '0')");
    expect(html).toContain("'Seek to '");
    // The delegated listener handles Enter / Space, not just click.
    expect(html).toMatch(/addEventListener\('keydown'/);
    expect(html).toContain("ev.key === 'Enter'");
  });
});

describe('buildReport — placeholder tab pills (audit A-10)', () => {
  it('adds a "soon" pill to the Actions and Timeline tabs only', () => {
    const html = buildReport(sampleEvents(), META);
    expect(html).toMatch(/id="tab-actions"[\s\S]*?<span class="soon-pill">soon<\/span>/);
    expect(html).toMatch(/id="tab-timeline"[\s\S]*?<span class="soon-pill">soon<\/span>/);
    // Exactly two pills — Console + Network must NOT get one.
    expect((html.match(/class="soon-pill"/g) ?? []).length).toBe(2);
    // The pill has a styling rule using the design tokens.
    expect(html).toContain('.tab .soon-pill {');
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

  it('emits the footer by default and when footer is explicitly true', () => {
    expect(buildReport(sampleEvents(), META)).toContain('<footer');
    expect(buildReport(sampleEvents(), META, { footer: true })).toContain('<footer');
  });

  it('omits the footer entirely when footer is false (audit A-8 opt-out)', () => {
    const html = buildReport(sampleEvents(), META, { footer: false });
    expect(html).not.toContain('<footer');
    expect(html).not.toContain('class="attrib"');
    // The document is still well-formed: </main> closes and </body> follows.
    expect(html).toMatch(/<\/main>/);
    expect(html).toMatch(/<\/body>\s*<\/html>/);
  });

  it('keeps the footer non-intrusive (class-based muted style, no external assets)', () => {
    const html = buildReport(sampleEvents(), META);
    const footerMatch = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/);
    expect(footerMatch).not.toBeNull();
    const footerHtml = footerMatch?.[0] ?? '';
    // Phase 6: footer styling moved from inline `style="color:#6b7280…"` to a
    // class-based rule (`.attrib { color: var(--muted) }`) inside SHELL_CSS.
    // We assert the class is present + the muted CSS variable is declared in
    // the document; the exact hex moved into the variable definition.
    expect(footerHtml).toMatch(/class="attrib"/);
    expect(html).toMatch(/--muted:\s*#8a92a0/);
    // No <script>, <link>, or remote asset reference inside the footer.
    expect(footerHtml).not.toMatch(/<script/);
    expect(footerHtml).not.toMatch(/<link/);
    // The href is the only outbound URL in the footer.
    const urls = footerHtml.match(/https?:\/\/[^\s"']+/g) ?? [];
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('github.com/Cubenest/rrweb-stack');
  });
});
