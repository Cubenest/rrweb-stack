// Tiny zero-dependency `confirm` prompt over node:readline. Mirrors the
// pattern used by peek-cli/src/lib/prompt.ts but pared down to the one form
// `tracelane init` needs (yes/no with a default). No multi-select or
// free-text prompts in v0.1.

import { type Interface, createInterface } from 'node:readline';

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/**
 * Yes/no confirm. `defaultYes` controls the [Y/n] vs [y/N] hint and the
 * answer when the user just hits Enter on an empty line. Closes the readline
 * interface in a `finally` so a Ctrl-C during the prompt doesn't leave stdin
 * raw.
 */
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
