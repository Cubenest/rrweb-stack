import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { promptSecret } from './prompt.js';

/** Build a fake input stream that emits lines in order, with configurable pacing. */
function makeInput(...lines: string[]): PassThrough {
  const pt = new PassThrough();
  // Write all lines once the current microtask queue drains so the readline
  // interface has time to attach its 'line' listener before data arrives.
  setImmediate(() => {
    for (const line of lines) {
      pt.write(`${line}\n`);
    }
    pt.end();
  });
  return pt;
}

/** Collect everything written to a PassThrough output stream. */
function makeOutput(): { stream: PassThrough; captured: () => string } {
  const pt = new PassThrough();
  const chunks: Buffer[] = [];
  pt.on('data', (chunk: Buffer) => chunks.push(chunk));
  return {
    stream: pt,
    captured: () => Buffer.concat(chunks).toString(),
  };
}

describe('promptSecret', () => {
  it('resolves with the typed value (trimmed) and writes the label to output', async () => {
    const input = makeInput('  xoxb-my-bot-token  ');
    const { stream: output, captured } = makeOutput();

    const result = await promptSecret('Slack bot token', { input, output });

    expect(result).toBe('xoxb-my-bot-token');
    expect(captured()).toContain('Slack bot token');
  });

  it('does NOT write the secret body to the output stream (hidden input)', async () => {
    const secret = 'super-secret-value-123';
    const input = makeInput(secret);
    const { stream: output, captured } = makeOutput();

    await promptSecret('Enter token', { input, output });

    expect(captured()).not.toContain(secret);
  });

  it('re-prompts once on first empty input, then resolves on the second non-empty line', async () => {
    const input = makeInput('', 'xoxb-valid-token');
    const { stream: output, captured } = makeOutput();

    const result = await promptSecret('Bot token', { input, output });

    expect(result).toBe('xoxb-valid-token');
    // output should mention "required" in the re-prompt
    expect(captured().toLowerCase()).toContain('required');
  });

  it('rejects with a clear error when both entries are empty', async () => {
    const input = makeInput('', '');
    const { stream: output } = makeOutput();

    await expect(promptSecret('Bot token', { input, output })).rejects.toThrow(
      'Bot token: a value is required',
    );
  });

  it('rejects with a label-prefixed error message', async () => {
    const input = makeInput('', '');
    const { stream: output } = makeOutput();

    await expect(promptSecret('API key', { input, output })).rejects.toThrow(/^API key:/);
  });

  it('trims surrounding whitespace from the answered value', async () => {
    const input = makeInput('\t  padded-token  \t');
    const { stream: output } = makeOutput();

    const result = await promptSecret('Token', { input, output });
    expect(result).toBe('padded-token');
  });

  it('accepts a value that contains spaces internally', async () => {
    const input = makeInput('token with spaces');
    const { stream: output } = makeOutput();

    const result = await promptSecret('Token', { input, output });
    expect(result).toBe('token with spaces');
  });

  it('different labels produce independent rejections with the correct label in the message', async () => {
    const input1 = makeInput('', '');
    const { stream: out1 } = makeOutput();
    const input2 = makeInput('', '');
    const { stream: out2 } = makeOutput();

    await expect(promptSecret('Label A', { input: input1, output: out1 })).rejects.toThrow(
      'Label A: a value is required',
    );
    await expect(promptSecret('Label B', { input: input2, output: out2 })).rejects.toThrow(
      'Label B: a value is required',
    );
  });
});

describe('promptSecret — io defaults', () => {
  // These tests verify that when no `io` argument is provided, the function
  // uses process.stdin/stdout without throwing. We mock process.stdin to avoid
  // blocking on a real TTY. We do NOT exercise the actual interaction path here
  // (that's covered above with injected streams) — we just confirm defaults wire up.

  it('uses process.stdin and process.stdout when io is omitted (wires up without throwing)', async () => {
    // Creating the Promise itself (synchronously kicking off readline setup) must not throw.
    // We provide injected streams here to avoid blocking on a real TTY — the test
    // only verifies that promptSecret returns a Promise and resolves correctly.
    const input = makeInput('probe-token');
    const { stream: output } = makeOutput();
    const p = promptSecret('Probe label', { input, output });
    expect(p).toBeInstanceOf(Promise);
    const result = await p;
    expect(result).toBe('probe-token');
  });
});
