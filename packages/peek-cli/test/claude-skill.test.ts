import { describe, expect, it } from 'vitest';
import { type SkillIO, claudeSkillTargetPath, installSkill } from '../src/lib/claude-skill.js';

const HOME = '/home/dev';
const SOURCE = '/pkg/dist/skills/peek-skill.md';
const SKILL_CONTENT = `---
name: peek
description: Use when investigating browser sessions...
---

# peek

body goes here.
`;

/** In-memory IO with separately-injectable read and write error maps. */
function makeIO(
  opts: {
    files?: Record<string, string>;
    readErrors?: Record<string, Error>;
    writeErrors?: Record<string, Error>;
  } = {},
): {
  io: SkillIO;
  files: Map<string, string>;
  dirs: Set<string>;
} {
  const files = new Map(Object.entries(opts.files ?? {}));
  const dirs = new Set<string>();
  const readErrors = new Map(Object.entries(opts.readErrors ?? {}));
  const writeErrors = new Map(Object.entries(opts.writeErrors ?? {}));
  const io: SkillIO = {
    fileExists: (p) => files.has(p),
    readFile: (p) => {
      const err = readErrors.get(p);
      if (err) throw err;
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFile: (p, c) => {
      const err = writeErrors.get(p);
      if (err) throw err;
      files.set(p, c);
    },
    mkdir: (p) => {
      dirs.add(p);
    },
  };
  return { io, files, dirs };
}

describe('claudeSkillTargetPath', () => {
  it('resolves to ~/.claude/skills/peek/SKILL.md', () => {
    expect(claudeSkillTargetPath('/home/dev')).toBe('/home/dev/.claude/skills/peek/SKILL.md');
  });

  it('handles a custom home dir', () => {
    expect(claudeSkillTargetPath('/Users/alice')).toBe('/Users/alice/.claude/skills/peek/SKILL.md');
  });
});

describe('installSkill', () => {
  it('writes a fresh skill when none exists', () => {
    const { io, files, dirs } = makeIO({ files: { [SOURCE]: SKILL_CONTENT } });
    const result = installSkill(HOME, io, SOURCE);
    expect(result.status).toBe('wrote');
    if (result.status === 'wrote') {
      expect(result.target).toBe(claudeSkillTargetPath(HOME));
    }
    expect(files.get(claudeSkillTargetPath(HOME))).toBe(SKILL_CONTENT);
    expect(dirs.has('/home/dev/.claude/skills/peek')).toBe(true);
  });

  it('returns unchanged when the on-disk skill matches the source byte-for-byte', () => {
    const target = claudeSkillTargetPath(HOME);
    const { io, files } = makeIO({
      files: { [SOURCE]: SKILL_CONTENT, [target]: SKILL_CONTENT },
    });
    const before = new Map(files);
    const result = installSkill(HOME, io, SOURCE);
    expect(result.status).toBe('unchanged');
    expect(files).toEqual(before); // no writes happened
  });

  it('returns updated and overwrites when the on-disk skill is stale', () => {
    const target = claudeSkillTargetPath(HOME);
    const { io, files } = makeIO({
      files: { [SOURCE]: SKILL_CONTENT, [target]: '# old skill\nstale content\n' },
    });
    const result = installSkill(HOME, io, SOURCE);
    expect(result.status).toBe('updated');
    expect(files.get(target)).toBe(SKILL_CONTENT);
  });

  it('returns source_missing when the source markdown is absent', () => {
    const { io } = makeIO();
    const result = installSkill(HOME, io, SOURCE);
    expect(result.status).toBe('source_missing');
    if (result.status === 'source_missing') {
      expect(result.source).toBe(SOURCE);
    }
  });

  it('returns error on writeFile failure (e.g. EACCES on ~/.claude/)', () => {
    const target = claudeSkillTargetPath(HOME);
    const { io } = makeIO({
      files: { [SOURCE]: SKILL_CONTENT },
      writeErrors: { [target]: new Error('EACCES: permission denied') },
    });
    const result = installSkill(HOME, io, SOURCE);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.target).toBe(target);
      expect(result.error).toContain('EACCES');
    }
  });

  it('falls through to overwrite when the existing file is unreadable', () => {
    const target = claudeSkillTargetPath(HOME);
    const { io, files } = makeIO({
      files: {
        [SOURCE]: SKILL_CONTENT,
        // existing target exists (fileExists returns true) but is unreadable
        [target]: '<unreadable placeholder>',
      },
      readErrors: { [target]: new Error('EIO: read failure') },
      // writeFile against target works fine
    });
    const result = installSkill(HOME, io, SOURCE);
    expect(result.status).toBe('updated');
    expect(files.get(target)).toBe(SKILL_CONTENT);
  });
});
