import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface PairingSecret {
  connectorId: string;
  secret: string;
}

function isPairingSecret(value: unknown): value is PairingSecret {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).connectorId === 'string' &&
    typeof (value as Record<string, unknown>).secret === 'string'
  );
}

/**
 * Read and parse a previously saved PairingSecret.
 * Returns null on ENOENT or malformed/invalid JSON — never throws.
 */
export async function loadPairingSecret(path: string): Promise<PairingSecret | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPairingSecret(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist a PairingSecret to disk with mode 0600.
 * Creates intermediate directories as needed.
 */
export async function savePairingSecret(path: string, value: PairingSecret): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
}

/**
 * Returns the default path for a connector's pairing secret.
 * e.g. ~/.config/peek-slack/pairing.json
 */
export function defaultSecretPath(connectorName: string): string {
  return join(homedir(), '.config', `peek-${connectorName}`, 'pairing.json');
}
