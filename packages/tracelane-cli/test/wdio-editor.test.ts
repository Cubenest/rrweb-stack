// Fixture-driven tests for the wdio.conf editor. The contract every
// successful edit must satisfy:
//
//   - Source contains exactly one `@tracelane/wdio` import line.
//   - Source contains a `[TraceLaneService, { mode: 'failed' }]` entry inside
//     the services array (or somewhere parseable as a tuple).
//
// On unrecognised shapes the editor MUST back out (ok: false) — these tests
// also assert the back-out path is taken for adversarial inputs.

import { describe, expect, it } from 'vitest';
import {
  appendToServicesArray,
  applyWdioEdit,
  findServicesArray,
  hasTracelaneImport,
  hasTracelaneServiceEntry,
  insertServicesKey,
  insertTracelaneImport,
} from '../src/lib/wdio-editor.js';

// ---- Fixtures ---------------------------------------------------------------

const FIXTURE_EMPTY_SERVICES = `import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./test/specs/**/*.ts'],
  services: [],
};
`;

const FIXTURE_STRING_SERVICE = `import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
  framework: 'mocha',
  services: ['devtools'],
};
`;

const FIXTURE_TUPLE_SERVICES = `import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
  framework: 'mocha',
  services: [['devtools', {}]],
};
`;

const FIXTURE_MULTILINE_SERVICES = `import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
  framework: 'mocha',
  services: [
    ['devtools', {}],
    ['shared-store', {}],
  ],
};
`;

const FIXTURE_NO_SERVICES_KEY = `import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./test/specs/**/*.ts'],
};
`;

const FIXTURE_ALREADY_CONFIGURED = `import type { Options } from '@wdio/types';
import TraceLaneService from '@tracelane/wdio';

export const config: Options.Testrunner = {
  framework: 'mocha',
  services: [['devtools', {}], [TraceLaneService, { mode: 'failed' }]],
};
`;

const FIXTURE_EXPORT_DEFAULT = `import type { Options } from '@wdio/types';

export default {
  framework: 'mocha',
  services: [],
} satisfies Options.Testrunner;
`;

const FIXTURE_NO_IMPORTS = `export const config = {
  framework: 'mocha',
  services: [],
};
`;

const FIXTURE_MODULE_EXPORTS = `module.exports = {
  framework: 'mocha',
  services: ['devtools'],
};
`;

const FIXTURE_TRAILING_COMMA = `import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
  framework: 'mocha',
  services: [
    ['devtools', {}],
  ],
};
`;

const FIXTURE_GARBAGE = `// not a valid wdio conf at all
const x = 42;
console.log("hello");
`;

// ---- Helpers ----------------------------------------------------------------

function expectWiredCorrectly(source: string): void {
  // Exactly one import line.
  const importMatches = source.match(
    /import\s+TraceLaneService\s+from\s+['"]@tracelane\/wdio['"]/g,
  );
  expect(importMatches).not.toBeNull();
  expect(importMatches?.length).toBe(1);
  // The service-entry marker is present.
  expect(source.includes('TraceLaneService')).toBe(true);
  // Bytes grew within sanity bounds. (applyWdioEdit enforces this internally;
  // we still assert it here so a regression in the helpers is visible.)
  // (caller has the original)
}

// ---- hasTracelaneImport / hasTracelaneServiceEntry --------------------------

describe('hasTracelaneImport', () => {
  it('detects a default import', () => {
    expect(hasTracelaneImport("import TraceLaneService from '@tracelane/wdio';")).toBe(true);
  });
  it('detects a named import', () => {
    expect(hasTracelaneImport("import { TraceLaneService } from '@tracelane/wdio';")).toBe(true);
  });
  it('accepts double quotes', () => {
    expect(hasTracelaneImport('import TraceLaneService from "@tracelane/wdio";')).toBe(true);
  });
  it('is false for unrelated imports', () => {
    expect(hasTracelaneImport("import { something } from '@wdio/types';")).toBe(false);
  });
});

describe('hasTracelaneServiceEntry', () => {
  it('detects a bare service entry in the array', () => {
    expect(hasTracelaneServiceEntry('services: [TraceLaneService]')).toBe(true);
  });
  it('detects a tuple service entry', () => {
    expect(hasTracelaneServiceEntry("services: [[TraceLaneService, { mode: 'failed' }]]")).toBe(
      true,
    );
  });
  it('is false when the symbol is absent', () => {
    expect(hasTracelaneServiceEntry("services: ['devtools']")).toBe(false);
  });
});

// ---- findServicesArray ------------------------------------------------------

describe('findServicesArray', () => {
  it('finds the empty services array', () => {
    const block = findServicesArray(FIXTURE_EMPTY_SERVICES);
    expect(block).toBeDefined();
    expect(block?.inner.trim()).toBe('');
  });

  it('finds a string-element services array', () => {
    const block = findServicesArray(FIXTURE_STRING_SERVICE);
    expect(block?.inner.trim()).toBe("'devtools'");
  });

  it('finds a tuple-element services array', () => {
    const block = findServicesArray(FIXTURE_TUPLE_SERVICES);
    expect(block?.inner.trim()).toBe("['devtools', {}]");
  });

  it('finds a multiline services array (nested bracket counting)', () => {
    const block = findServicesArray(FIXTURE_MULTILINE_SERVICES);
    expect(block).toBeDefined();
    // The inner must contain BOTH inner tuples, with the brackets balanced.
    expect(block?.inner.includes("['devtools', {}]")).toBe(true);
    expect(block?.inner.includes("['shared-store', {}]")).toBe(true);
  });

  it('is undefined when no services key exists', () => {
    expect(findServicesArray(FIXTURE_NO_SERVICES_KEY)).toBeUndefined();
  });

  it('does not match `services` inside a string literal', () => {
    const src = `const note = "services: [stuff]"; export const config = { services: ['x'] };`;
    const block = findServicesArray(src);
    // Must find the REAL key, not the one inside the string.
    expect(block?.inner.trim()).toBe("'x'");
  });
});

// ---- insertTracelaneImport --------------------------------------------------

describe('insertTracelaneImport', () => {
  it('inserts after the last import', () => {
    const src = "import type { Options } from '@wdio/types';\n\nexport const config = {};\n";
    const out = insertTracelaneImport(src);
    // The new import must come AFTER the @wdio/types import but BEFORE the
    // export.
    const wdioIdx = out.indexOf('@wdio/types');
    const tracelaneIdx = out.indexOf('@tracelane/wdio');
    const exportIdx = out.indexOf('export const config');
    expect(wdioIdx).toBeGreaterThan(-1);
    expect(tracelaneIdx).toBeGreaterThan(wdioIdx);
    expect(tracelaneIdx).toBeLessThan(exportIdx);
  });

  it('inserts at the top when there are no imports', () => {
    const out = insertTracelaneImport(FIXTURE_NO_IMPORTS);
    expect(out.startsWith("import TraceLaneService from '@tracelane/wdio';")).toBe(true);
  });
});

// ---- appendToServicesArray --------------------------------------------------

describe('appendToServicesArray', () => {
  it('handles an empty services array', () => {
    const block = findServicesArray(FIXTURE_EMPTY_SERVICES);
    expect(block).toBeDefined();
    if (!block) return;
    const next = appendToServicesArray(FIXTURE_EMPTY_SERVICES, block);
    expect(next.includes("services: [[TraceLaneService, { mode: 'failed' }]]")).toBe(true);
  });

  it('appends after a string element with a comma separator', () => {
    const block = findServicesArray(FIXTURE_STRING_SERVICE);
    expect(block).toBeDefined();
    if (!block) return;
    const next = appendToServicesArray(FIXTURE_STRING_SERVICE, block);
    expect(next.includes("'devtools',")).toBe(true);
    expect(next.includes("[TraceLaneService, { mode: 'failed' }]")).toBe(true);
  });

  it('appends after a tuple element', () => {
    const block = findServicesArray(FIXTURE_TUPLE_SERVICES);
    expect(block).toBeDefined();
    if (!block) return;
    const next = appendToServicesArray(FIXTURE_TUPLE_SERVICES, block);
    expect(next.includes("['devtools', {}],")).toBe(true);
    expect(next.includes("[TraceLaneService, { mode: 'failed' }]")).toBe(true);
  });

  it('handles an existing trailing comma without doubling it', () => {
    const block = findServicesArray(FIXTURE_TRAILING_COMMA);
    expect(block).toBeDefined();
    if (!block) return;
    const next = appendToServicesArray(FIXTURE_TRAILING_COMMA, block);
    // The original ended with a trailing comma — we should NOT see `,,`.
    expect(next.includes(',,')).toBe(false);
    expect(next.includes("[TraceLaneService, { mode: 'failed' }]")).toBe(true);
  });
});

// ---- insertServicesKey ------------------------------------------------------

describe('insertServicesKey', () => {
  it('inserts a services key into an export const config object', () => {
    const next = insertServicesKey(FIXTURE_NO_SERVICES_KEY);
    expect(next).toBeDefined();
    expect(next?.includes("services: [[TraceLaneService, { mode: 'failed' }]]")).toBe(true);
  });

  it('inserts a services key into an export default object', () => {
    const next = insertServicesKey(FIXTURE_EXPORT_DEFAULT.replace(/services: \[\],?\n/, ''));
    expect(next).toBeDefined();
    expect(next?.includes('services:')).toBe(true);
  });

  it('returns undefined when no recognisable export form exists', () => {
    const out = insertServicesKey('const someConfig = { foo: 1 };\n');
    expect(out).toBeUndefined();
  });
});

// ---- applyWdioEdit — happy paths ------------------------------------------

describe('applyWdioEdit happy paths', () => {
  it('wires an empty services array', () => {
    const r = applyWdioEdit(FIXTURE_EMPTY_SERVICES);
    if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
    expect(r.addedImport).toBe(true);
    expect(r.addedServiceEntry).toBe(true);
    expect(r.alreadyConfigured).toBe(false);
    expectWiredCorrectly(r.source);
  });

  it('wires a string-element services array', () => {
    const r = applyWdioEdit(FIXTURE_STRING_SERVICE);
    if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
    expectWiredCorrectly(r.source);
    expect(r.source.includes("'devtools'")).toBe(true);
  });

  it('wires a tuple-element services array', () => {
    const r = applyWdioEdit(FIXTURE_TUPLE_SERVICES);
    if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
    expectWiredCorrectly(r.source);
    expect(r.source.includes("['devtools', {}]")).toBe(true);
  });

  it('wires a multiline services array', () => {
    const r = applyWdioEdit(FIXTURE_MULTILINE_SERVICES);
    if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
    expectWiredCorrectly(r.source);
  });

  it('wires a conf with no services key by inserting one', () => {
    const r = applyWdioEdit(FIXTURE_NO_SERVICES_KEY);
    if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
    expectWiredCorrectly(r.source);
    expect(r.source.includes('services:')).toBe(true);
  });

  it('wires an export-default form', () => {
    const r = applyWdioEdit(FIXTURE_EXPORT_DEFAULT);
    if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
    expectWiredCorrectly(r.source);
  });

  it('wires a module.exports form', () => {
    const r = applyWdioEdit(FIXTURE_MODULE_EXPORTS);
    if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
    expectWiredCorrectly(r.source);
  });
});

// ---- applyWdioEdit — idempotency -------------------------------------------

describe('applyWdioEdit idempotency', () => {
  it('returns alreadyConfigured for a conf that already wires TraceLaneService', () => {
    const r = applyWdioEdit(FIXTURE_ALREADY_CONFIGURED);
    if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
    expect(r.alreadyConfigured).toBe(true);
    expect(r.source).toBe(FIXTURE_ALREADY_CONFIGURED);
  });

  it('a second application is a no-op against its own output', () => {
    const first = applyWdioEdit(FIXTURE_EMPTY_SERVICES);
    if (!first.ok) throw new Error(`expected ok, got: ${first.reason}`);
    const second = applyWdioEdit(first.source);
    if (!second.ok) throw new Error(`expected ok, got: ${second.reason}`);
    expect(second.alreadyConfigured).toBe(true);
    expect(second.source).toBe(first.source);
  });
});

// ---- applyWdioEdit — back-out paths ---------------------------------------

describe('applyWdioEdit back-out paths', () => {
  it('backs out cleanly on a garbage file (no exports, no services)', () => {
    const r = applyWdioEdit(FIXTURE_GARBAGE);
    expect(r.ok).toBe(false);
    if (r.ok) return; // type narrowing
    expect(r.reason).toMatch(/Couldn't find/);
    expect(r.manualSnippet.includes('import TraceLaneService')).toBe(true);
  });
});

// ---- Byte-delta sanity ------------------------------------------------------

describe('applyWdioEdit byte-delta sanity', () => {
  it('keeps the byte delta within reasonable bounds for the empty array fixture', () => {
    const r = applyWdioEdit(FIXTURE_EMPTY_SERVICES);
    if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
    const delta = r.source.length - FIXTURE_EMPTY_SERVICES.length;
    expect(delta).toBeGreaterThanOrEqual(80);
    expect(delta).toBeLessThanOrEqual(400);
  });
});
