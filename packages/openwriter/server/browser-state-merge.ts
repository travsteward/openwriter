import { splitMergedDoc, reconcileCanonicalToBaselines, type PendingEntry } from './pending-overlay.js';
import type { PadDocument } from './state.js';

// adr: adr/pending-overlay-model.md
/** Merge the browser's canonical edits with newer server proposals. State
 * installation and persistence remain the caller's responsibility. */
export function mergeBrowserState(browserDoc: PadDocument, browserVersion: number, serverEntries: Iterable<PendingEntry>) {
  const { canonical, overlayEntries: browserOverlay } = splitMergedDoc(browserDoc);
  const preserved = [...serverEntries].filter(entry => (entry.addedAtVersion ?? 0) > browserVersion);
  const merged = new Map<string, PendingEntry>();
  for (const entry of browserOverlay) {
    if (!merged.has(entry.nodeId)) merged.set(entry.nodeId, entry);
  }
  for (const entry of preserved) merged.set(entry.nodeId, entry);
  const entries = [...merged.values()];
  reconcileCanonicalToBaselines(canonical, entries);
  return { canonical, entries, preservedServerEntries: preserved.length };
}
