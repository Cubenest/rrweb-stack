import { createInterface } from 'node:readline';

/**
 * Prompt the user for a secret value on the terminal with hidden input (no echo).
 *
 * Uses `node:readline` with a `_writeToOutput` override so that after the
 * initial label is written, subsequent keystrokes are not echoed to `output`.
 * This keeps the secret off the screen without requiring a real TTY or any
 * native dependency.
 *
 * @param label - The prompt label shown to the user (e.g. "Slack bot token").
 * @param io    - Optional injectable streams for testing. Defaults to
 *                `process.stdin` / `process.stdout`.
 */
export async function promptSecret(
  label: string,
  io?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream },
): Promise<string> {
  const input = io?.input ?? process.stdin;
  const output = io?.output ?? process.stdout;

  return new Promise<string>((resolve, reject) => {
    let muted = false;
    let attempt = 0;

    const rl = createInterface({
      input,
      output,
      terminal: true,
    });

    // Override _writeToOutput: write normally until the first prompt is
    // displayed, then suppress all echoing.  The interface's internal
    // question() call pipes its prompt through this method before the
    // 'line' event fires, so the initial prompt gets through.
    (rl as unknown as { _writeToOutput(text: string): void })._writeToOutput = (text: string) => {
      if (!muted) {
        output.write(text);
      }
      // while muted: write nothing — suppress character echo
    };

    function ask(): void {
      const promptText = attempt === 0 ? `${label}: ` : `${label} (a value is required): `;

      // Unmute momentarily so the prompt label is visible, then mute again.
      muted = false;
      output.write(promptText);
      muted = true;

      rl.once('line', (line: string) => {
        const value = line.trim();
        if (value.length > 0) {
          rl.close();
          resolve(value);
        } else {
          attempt += 1;
          if (attempt >= 2) {
            rl.close();
            reject(new Error(`${label}: a value is required`));
          } else {
            // Re-prompt once
            ask();
          }
        }
      });
    }

    ask();
  });
}
