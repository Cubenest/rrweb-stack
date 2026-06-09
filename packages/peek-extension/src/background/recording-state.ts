import { originFromUrl } from '../activation/origin';
import { isOriginEnabled } from '../activation/storage';
import { getPermissionLevel } from '../permissions/store';

/**
 * Whether peek is actively recording the given tab URL. The origin must be
 * user-enabled AND its permission level must not be 0 — level 0 (Off) suppresses
 * both the tool surface and recording (ADR-0010). This mirrors the gate in the
 * SW's `maybeInject`, so the indicator and the recorder always agree on "is this
 * tab recording?". Storage-read failures fail closed (not recording).
 */
export async function isTabRecording(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    if (!(await isOriginEnabled(url))) return false;
    const origin = originFromUrl(url);
    if (origin !== null && (await getPermissionLevel(origin)) === 0) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Per-tab recording-active flags. In-memory and SW-instance-scoped (re-derived
 * on wake via the SW's reconcile pass), mirroring RecorderStatsStore.
 */
export class RecordingStateStore {
  private readonly byTab = new Map<number, boolean>();

  get(tabId: number): boolean {
    return this.byTab.get(tabId) ?? false;
  }

  /** Set the flag; returns true if the value changed. */
  set(tabId: number, recording: boolean): boolean {
    const prev = this.byTab.get(tabId) ?? false;
    if (prev === recording) return false;
    if (recording) this.byTab.set(tabId, true);
    else this.byTab.delete(tabId);
    return true;
  }

  /** Clear a tab's flag (on tab close); returns true if it changed. */
  clear(tabId: number): boolean {
    return this.set(tabId, false);
  }
}
