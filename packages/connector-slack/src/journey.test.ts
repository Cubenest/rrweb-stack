import { describe, expect, it } from 'vitest';
import {
  SLACK_BLOCK_LIMIT,
  isJourneyCausalChain,
  journeyBlocks,
  journeyMarkdown,
} from './journey.js';
import type { JourneyCausalChain, JourneyTimelineEntry } from './journey.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(
  overrides: Partial<JourneyTimelineEntry> & { kind: JourneyTimelineEntry['kind'] },
): JourneyTimelineEntry {
  return {
    ts: 1000,
    relMs: -500,
    summary: `${overrides.kind} summary`,
    ...overrides,
  };
}

function makeJourney(overrides?: Partial<JourneyCausalChain>): JourneyCausalChain {
  return {
    errorId: 1,
    errorTs: 2000,
    error: {
      id: 1,
      ts: 2000,
      level: 'error',
      message: 'TypeError: Cannot read property of undefined',
      stack: 'Error: TypeError\n  at foo (bar.js:10:5)',
    },
    windowMs: 5000,
    narrative:
      'In the 5000ms before console error #1: 2 user action(s), 1 network error(s), 0 DOM mutation(s).',
    timeline: [
      makeEntry({ kind: 'action', relMs: -1500, summary: 'click `#submit`' }),
      makeEntry({ kind: 'network', relMs: -800, summary: 'POST /api/save → 500' }),
      makeEntry({ kind: 'error', relMs: 0, summary: 'console error: TypeError' }),
    ],
    networkErrors: [{ ts: 1200, method: 'POST', url: '/api/save', status: 500 }],
    truncated: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// journeyMarkdown tests
// ---------------------------------------------------------------------------

describe('journeyMarkdown', () => {
  it('contains the narrative text', () => {
    const md = journeyMarkdown(makeJourney());
    expect(md).toContain('5000ms before console error');
  });

  it('starts with an H1 failure headline containing the error level + message', () => {
    const md = journeyMarkdown(makeJourney());
    const firstLine = md.split('\n')[0] ?? '';
    expect(firstLine).toMatch(/^# ERROR:/);
    expect(firstLine).toContain('TypeError');
  });

  it('contains an H2 "The path" section', () => {
    const md = journeyMarkdown(makeJourney());
    expect(md).toContain('## The path');
  });

  it('renders each timeline entry with its relMs offset and summary', () => {
    const md = journeyMarkdown(makeJourney());
    expect(md).toContain('`-1500ms`');
    expect(md).toContain('click `#submit`');
    expect(md).toContain('`-800ms`');
    expect(md).toContain('POST /api/save');
    expect(md).toContain('`+0ms`');
  });

  it('renders per-kind emoji: 🖱 for action, 🌐 for network, ⚠ for error', () => {
    const md = journeyMarkdown(makeJourney());
    expect(md).toContain('🖱');
    expect(md).toContain('🌐');
    expect(md).toContain('⚠');
  });

  it('renders ⌨ emoji for action summaries starting with "type "', () => {
    const journey = makeJourney({
      timeline: [
        makeEntry({ kind: 'action', relMs: -100, summary: 'type "hello" into #name' }),
        makeEntry({ kind: 'error', relMs: 0, summary: 'console error: oops' }),
      ],
    });
    const md = journeyMarkdown(journey);
    expect(md).toContain('⌨');
  });

  it('renders 🧭 emoji for action summaries starting with "navigate "', () => {
    const journey = makeJourney({
      timeline: [
        makeEntry({ kind: 'action', relMs: -100, summary: 'navigate to https://example.com' }),
        makeEntry({ kind: 'error', relMs: 0, summary: 'console error: oops' }),
      ],
    });
    const md = journeyMarkdown(journey);
    expect(md).toContain('🧭');
  });

  it('contains an H2 "Network failures" table when networkErrors is non-empty', () => {
    const md = journeyMarkdown(makeJourney());
    expect(md).toContain('## Network failures');
    expect(md).toContain('| Method | URL | Status |');
    expect(md).toContain('| POST | /api/save | 500 |');
  });

  it('omits the Network failures section when networkErrors is empty', () => {
    const md = journeyMarkdown(makeJourney({ networkErrors: [] }));
    expect(md).not.toContain('## Network failures');
  });

  it('renders the stack trace code block when error.stack is present', () => {
    const md = journeyMarkdown(makeJourney());
    expect(md).toContain('## Stack trace');
    expect(md).toContain('```');
    expect(md).toContain('at foo (bar.js');
  });

  it('omits the stack trace section when error.stack is absent', () => {
    const journey = makeJourney();
    const journeyNoStack: JourneyCausalChain = {
      ...journey,
      error: {
        id: journey.error.id,
        ts: journey.error.ts,
        level: journey.error.level,
        message: journey.error.message,
      },
    };
    const md = journeyMarkdown(journeyNoStack);
    expect(md).not.toContain('## Stack trace');
  });

  it('truncates long timelines with a "+N more" line', () => {
    const manyEntries: JourneyTimelineEntry[] = Array.from({ length: 250 }, (_, i) => ({
      ts: 1000 + i,
      relMs: i - 200,
      kind: 'action' as const,
      summary: `click #btn-${i}`,
    }));
    const journey = makeJourney({ timeline: manyEntries });
    const md = journeyMarkdown(journey);
    expect(md).toContain('more entries (truncated)');
    // Should NOT contain all 250 entries
    expect(md).not.toContain('#btn-249');
  });

  it('does not truncate timelines within MAX_TIMELINE_ENTRIES (200)', () => {
    const entries: JourneyTimelineEntry[] = Array.from({ length: 150 }, (_, i) => ({
      ts: 1000 + i,
      relMs: i - 150,
      kind: 'action' as const,
      summary: `click #btn-${i}`,
    }));
    const journey = makeJourney({ timeline: entries });
    const md = journeyMarkdown(journey);
    expect(md).not.toContain('more entries');
    expect(md).toContain('#btn-149');
  });

  it('renders errorText for a net-level failure with null status (not literal "null")', () => {
    // peek-mcp emits `status: null` for a net-level failure (no HTTP status);
    // JSON round-trips it as null, so the renderer must fall through to errorText.
    const journey = makeJourney({
      networkErrors: [
        {
          ts: 1200,
          method: 'GET',
          url: '/api/data',
          status: null,
          errorText: 'ERR_CONNECTION_REFUSED',
        },
      ],
    });
    const md = journeyMarkdown(journey);
    expect(md).toContain('| GET | /api/data | ERR_CONNECTION_REFUSED |');
    expect(md).not.toContain('| null |');
  });

  it('caps network error table at MAX_TABLE_ROWS (25) with a "+N more" row', () => {
    const manyNet = Array.from({ length: 40 }, (_, i) => ({
      ts: 1000 + i,
      method: 'GET',
      url: `/api/resource/${i}`,
      status: 404,
    }));
    const journey = makeJourney({ networkErrors: manyNet });
    const md = journeyMarkdown(journey);
    expect(md).toContain('_+15 more_');
  });
});

// ---------------------------------------------------------------------------
// journeyBlocks tests
// ---------------------------------------------------------------------------

describe('journeyBlocks', () => {
  it('returns an array of blocks with a header and narrative section', () => {
    const blocks = journeyBlocks(makeJourney());
    const header = blocks.find((b) => b.type === 'header') as
      | { text: { text: string } }
      | undefined;
    expect(header).toBeDefined();
    expect(header?.text.text).toContain('ERROR');
    expect(header?.text.text).toContain('TypeError');

    const section = blocks.find((b) => b.type === 'section') as
      | { text: { text: string } }
      | undefined;
    expect(section?.text.text).toContain('5000ms');
  });

  it('includes a "The path" label block', () => {
    const blocks = journeyBlocks(makeJourney());
    const pathLabel = blocks
      .filter((b) => b.type === 'section')
      .find((b) => (b as { text: { text: string } }).text.text === '*The path*');
    expect(pathLabel).toBeDefined();
  });

  it('renders timeline entries as section blocks', () => {
    const blocks = journeyBlocks(makeJourney());
    const texts = blocks
      .filter((b) => b.type === 'section')
      .map((b) => (b as { text: { text: string } }).text.text);
    const hasBtnEntry = texts.some((t) => t.includes('click `#submit`'));
    expect(hasBtnEntry).toBe(true);
  });

  it('never exceeds SLACK_BLOCK_LIMIT (50) blocks', () => {
    const manyEntries: JourneyTimelineEntry[] = Array.from({ length: 100 }, (_, i) => ({
      ts: 1000 + i,
      relMs: i - 100,
      kind: 'action' as const,
      summary: `click #btn-${i}`,
    }));
    const journey = makeJourney({ timeline: manyEntries });
    const blocks = journeyBlocks(journey);
    expect(blocks.length).toBeLessThanOrEqual(SLACK_BLOCK_LIMIT);
  });

  it('appends a "+N more" context block when timeline is truncated', () => {
    const manyEntries: JourneyTimelineEntry[] = Array.from({ length: 50 }, (_, i) => ({
      ts: 1000 + i,
      relMs: i - 50,
      kind: 'action' as const,
      summary: `click #btn-${i}`,
    }));
    const journey = makeJourney({ timeline: manyEntries });
    const blocks = journeyBlocks(journey);
    const contextBlocks = blocks.filter((b) => b.type === 'context') as Array<{
      elements: Array<{ text: string }>;
    }>;
    const hasTruncation = contextBlocks.some((c) =>
      c.elements.some((e) => e.text.includes('more timeline entries')),
    );
    expect(hasTruncation).toBe(true);
  });

  it('does not add a truncation block when timeline fits', () => {
    const blocks = journeyBlocks(makeJourney());
    const contextBlocks = blocks.filter((b) => b.type === 'context') as Array<{
      elements: Array<{ text: string }>;
    }>;
    const hasTruncation = contextBlocks.some((c) =>
      c.elements.some((e) => e.text.includes('more timeline entries')),
    );
    expect(hasTruncation).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isJourneyCausalChain type guard
// ---------------------------------------------------------------------------

describe('isJourneyCausalChain', () => {
  it('returns true for a well-formed CausalChain object', () => {
    expect(isJourneyCausalChain(makeJourney())).toBe(true);
  });

  it('returns false for null', () => {
    expect(isJourneyCausalChain(null)).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isJourneyCausalChain('not a chain')).toBe(false);
  });

  it('returns false when errorId is missing', () => {
    const { errorId: _removed, ...rest } = makeJourney();
    expect(isJourneyCausalChain(rest)).toBe(false);
  });

  it('returns false when narrative is missing', () => {
    const { narrative: _removed, ...rest } = makeJourney();
    expect(isJourneyCausalChain(rest)).toBe(false);
  });

  it('returns false when timeline is not an array', () => {
    expect(isJourneyCausalChain({ ...makeJourney(), timeline: 'not-array' })).toBe(false);
  });

  it('returns false when error.level is missing (renderers dereference it)', () => {
    const journey = makeJourney();
    const malformed = {
      ...journey,
      error: { id: 1, ts: 2000, message: 'boom' }, // no level
    };
    expect(isJourneyCausalChain(malformed)).toBe(false);
  });
});
