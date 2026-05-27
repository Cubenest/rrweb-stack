// Thin interactive-prompt shell for `peek init`. Deliberately tiny + dependency
// free (a numbered multi-select over node:readline) so the wizard's PURE logic
// (detection + config merge in init-config.ts) carries the testable weight and
// this file stays an I/O edge that's exercised manually. Not unit-tested.

import { type Interface, createInterface } from 'node:readline';

/**
 * One selectable option. The optional fields explicitly allow `undefined` so
 * callers can build choices inline (e.g. `hint: maybeUndefined`) under
 * `exactOptionalPropertyTypes`.
 */
export interface Choice<T> {
  readonly value: T;
  readonly label: string;
  /** Pre-checked in the multi-select default. */
  readonly checked?: boolean | undefined;
  /** Shown but not selectable (e.g. Cline "manual config required"). */
  readonly disabled?: boolean | undefined;
  /** Optional dim hint after the label. */
  readonly hint?: string | undefined;
}

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/**
 * Numbered multi-select. Prints each choice with its current [x]/[ ] state and
 * reads a comma/space-separated list of numbers to toggle the default. Empty
 * input keeps the defaults. Disabled choices can't be selected. Returns the
 * chosen values in declaration order.
 */
export async function multiSelect<T>(message: string, choices: Choice<T>[]): Promise<T[]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const selectable = choices.filter((c) => !c.disabled);
    const checked = new Set<T>(selectable.filter((c) => c.checked).map((c) => c.value));

    process.stdout.write(`${message}\n`);
    choices.forEach((c, i) => {
      const num = c.disabled ? '  ' : String(i + 1).padStart(2, ' ');
      const box = c.disabled ? '   ' : checked.has(c.value) ? '[x]' : '[ ]';
      const hint = c.hint ? `  (${c.hint})` : '';
      const dim = c.disabled ? '  — manual config required' : '';
      process.stdout.write(`  ${num} ${box} ${c.label}${hint}${dim}\n`);
    });

    const answer = (
      await ask(rl, 'Toggle by number (comma/space separated), Enter to accept defaults: ')
    ).trim();

    if (answer.length > 0) {
      const tokens = answer.split(/[\s,]+/).filter(Boolean);
      for (const tok of tokens) {
        const idx = Number(tok) - 1;
        const choice = choices[idx];
        if (!choice || choice.disabled) continue;
        if (checked.has(choice.value)) checked.delete(choice.value);
        else checked.add(choice.value);
      }
    }

    return choices.filter((c) => !c.disabled && checked.has(c.value)).map((c) => c.value);
  } finally {
    rl.close();
  }
}

/** Yes/no confirm. `defaultYes` controls the [Y/n] vs [y/N] default on empty input. */
export async function confirm(message: string, defaultYes = true): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultYes ? '[Y/n]' : '[y/N]';
    const answer = (await ask(rl, `${message} ${suffix} `)).trim().toLowerCase();
    if (answer.length === 0) return defaultYes;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
