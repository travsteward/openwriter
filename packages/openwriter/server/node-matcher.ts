/**
 * Matcher — given an original node graph (with IDs) and a new doc body,
 * produce an updated node graph where surviving blocks keep their IDs.
 *
 * Core principle: the slot is innocent until proven changed. Every mutation
 * rule is a deterministic detector for a specific kind of slot change. If
 * no rule fires for an orphan + unmatched pair, the slot-continuity fallback
 * pairs them by structural position (same type, between same pinned anchors).
 *
 * Rule order:
 *   Phase 1: exact fingerprint match, two-pass (mutual-unique + slot-aware)
 *   Phase 2 rules (each math-only, deterministic):
 *     - N-way split detection (sentence-array concatenation)
 *     - N-way merge detection (sentence-array concatenation, reversed)
 *     - Type-change detection (TipTap convention: content survives, type changes)
 *     - Edit detection (shared sentence tuples, slot-region constrained)
 *     - Slot-continuity fallback (same type, same pinned-anchor neighborhood)
 *     - Graveyard restore (paste-back / undo of recently deleted blocks)
 *     - Insert (any block still unmatched → fresh ID)
 *   Phase 3: orphans = previousNodes entries no rule claimed (= deletes)
 *
 * Fingerprints carry one tuple per sentence: char count, content hash,
 * terminator type. Hash equality identifies "same sentence text" in 8 bytes.
 * Documented in node-fingerprint.ts.
 *
 * adr: adr/node-identity-matcher.md
 */

import { generateNodeId } from './helpers.js';
import {
  fingerprintAll,
  isExactMatch,
  isSameContent,
  sentenceArraysEqual,
  type Block,
  type Fingerprint,
} from './node-fingerprint.js';

export interface NodeEntry {
  id: string;
  fingerprint: Fingerprint;
}

export interface PinnedEntry {
  id: string;
  position: number;
  fingerprint: Fingerprint;
  block: Block;
  mutation: string;
}

export interface UnmatchedEntry {
  position: number;
  fingerprint: Fingerprint;
  block: Block;
}

export interface MatchResult {
  pinned: PinnedEntry[];
  unmatched: UnmatchedEntry[];
  orphaned: NodeEntry[];
  graveyardRestored: PinnedEntry[];
  nextGraveyard: NodeEntry[];
  summary: {
    totalBlocks: number;
    pinnedCount: number;
    unmatchedCount: number;
    orphanedCount: number;
    coverage: number;
  };
}

export interface MatchOptions {
  graveyard?: NodeEntry[];
}

/**
 * Run the matcher.
 *
 * @param previousNodes - frontmatter `nodes` map from the prior save
 * @param newBlocks - block list of the new doc body
 * @param options.graveyard - optional array of recently-deleted entries.
 *   Lets paste-back/undo restore the original ID.
 */
export function matchNodes(
  previousNodes: NodeEntry[],
  newBlocks: Block[],
  options: MatchOptions = {},
): MatchResult {
  const graveyard = options.graveyard || [];
  const newFingerprints = fingerprintAll(newBlocks);

  const pinned: PinnedEntry[] = [];
  const claimedPrevIds = new Set<string>();
  const claimedGraveIds = new Set<string>();
  const unmatched: UnmatchedEntry[] = newBlocks.map((block, i) => ({
    position: newFingerprints[i].position,
    fingerprint: newFingerprints[i],
    block,
  }));

  pinCarriedIds(unmatched, previousNodes, claimedPrevIds, pinned);
  pinExactMatches(unmatched, previousNodes, claimedPrevIds, pinned);

  applySplitRule(unmatched, previousNodes, claimedPrevIds, pinned);
  applyMergeRule(unmatched, previousNodes, claimedPrevIds, pinned);
  applyTypeChangeRule(unmatched, previousNodes, claimedPrevIds, pinned);
  applyEditRule(unmatched, previousNodes, claimedPrevIds, pinned);

  applySlotContinuityRule(unmatched, previousNodes, claimedPrevIds, pinned, graveyard);

  applyGraveyardRestoreRule(unmatched, graveyard, claimedGraveIds, pinned);

  applyInsertRule(unmatched, pinned, previousNodes, claimedPrevIds, graveyard, claimedGraveIds);

  const orphaned: NodeEntry[] = previousNodes
    .filter((prev) => !claimedPrevIds.has(prev.id))
    .map((prev) => ({ id: prev.id, fingerprint: prev.fingerprint }));

  const remainingGraveyard = graveyard.filter((g) => !claimedGraveIds.has(g.id));

  return {
    pinned,
    unmatched,
    orphaned,
    graveyardRestored: pinned.filter((p) => p.mutation === 'graveyard-restore'),
    nextGraveyard: [...orphaned, ...remainingGraveyard],
    summary: {
      totalBlocks: newBlocks.length,
      pinnedCount: pinned.length,
      unmatchedCount: unmatched.length,
      orphanedCount: orphaned.length,
      coverage: newBlocks.length > 0 ? pinned.length / newBlocks.length : 1,
    },
  };
}

/** Thread state between sequential matcher runs. */
export function rebuildPreviousFromResult(result: MatchResult): NodeEntry[] {
  return result.pinned.map((p) => ({ id: p.id, fingerprint: p.fingerprint }));
}

/** Build a previousNodes map from a block list (bootstrap on first save). */
export function bootstrapPreviousNodes(originalBlocks: Block[]): NodeEntry[] {
  const fps = fingerprintAll(originalBlocks);
  return originalBlocks.map((_block, i) => ({
    id: generateNodeId(),
    fingerprint: fps[i],
  }));
}

// ----------------------------------------------------------------------
// Phase 0 — a block that carries a known ID keeps it
// ----------------------------------------------------------------------
// The tree already names its blocks. When exactly one block carries an ID
// from previousNodes, that block IS that node, whatever its content now is;
// the fingerprint rules only guess identity for blocks the tree cannot name.
// Without this, a known block whose text changed wholesale went unmatched, a
// neighbouring block with an unknown ID took its ID by slot continuity, and
// the real owner was re-minted. A pending delete then landed on the wrong
// paragraph. A duplicated ID (e.g. a split that copied attrs) names nothing
// and is left to the rules. adr: adr/node-identity-matcher.md
function pinCarriedIds(
  unmatched: UnmatchedEntry[],
  previousNodes: NodeEntry[],
  claimedPrevIds: Set<string>,
  pinned: PinnedEntry[],
): void {
  const carriers = new Map<string, number>();
  for (const u of unmatched) {
    if (u.block.id) carriers.set(u.block.id, (carriers.get(u.block.id) || 0) + 1);
  }
  for (const prev of previousNodes) {
    if (claimedPrevIds.has(prev.id) || carriers.get(prev.id) !== 1) continue;
    const idx = unmatched.findIndex((u) => u.block.id === prev.id);
    const cand = unmatched[idx];
    claimedPrevIds.add(prev.id);
    pinned.push({
      id: prev.id,
      position: cand.position,
      fingerprint: cand.fingerprint,
      block: cand.block,
      mutation: isExactMatch(prev.fingerprint, cand.fingerprint)
        ? (prev.fingerprint.position !== cand.position ? 'moved' : 'unchanged')
        : 'edited',
    });
    unmatched.splice(idx, 1);
  }
}

// ----------------------------------------------------------------------
// Phase 1 — exact-match pinning, two-pass
// ----------------------------------------------------------------------
function pinExactMatches(
  unmatched: UnmatchedEntry[],
  previousNodes: NodeEntry[],
  claimedPrevIds: Set<string>,
  pinned: PinnedEntry[],
): void {
  // -------- PASS A: mutual-unique pairs --------
  let changedA = true;
  while (changedA) {
    changedA = false;

    const prevToCands = new Map<string, UnmatchedEntry[]>();
    const candToPrevs = new Map<number, NodeEntry[]>();

    for (const prev of previousNodes) {
      if (claimedPrevIds.has(prev.id)) continue;
      const cands = unmatched.filter((u) => isExactMatch(prev.fingerprint, u.fingerprint));
      prevToCands.set(prev.id, cands);
      for (const c of cands) {
        if (!candToPrevs.has(c.position)) candToPrevs.set(c.position, []);
        candToPrevs.get(c.position)!.push(prev);
      }
    }

    for (const [prevId, cands] of prevToCands) {
      if (claimedPrevIds.has(prevId)) continue;
      if (cands.length !== 1) continue;
      const cand = cands[0];
      const prevs = candToPrevs.get(cand.position);
      if (!prevs || prevs.length !== 1) continue;
      if (!unmatched.includes(cand)) continue;

      const prev = previousNodes.find((p) => p.id === prevId)!;
      const origPos = prev.fingerprint.position;
      claimedPrevIds.add(prevId);
      pinned.push({
        id: prevId,
        position: cand.position,
        fingerprint: cand.fingerprint,
        block: cand.block,
        mutation: origPos !== cand.position ? 'moved' : 'unchanged',
      });
      const idx = unmatched.indexOf(cand);
      unmatched.splice(idx, 1);
      changedA = true;
    }
  }

  // -------- PASS B: slot-aware position-distance --------
  let changedB = true;
  while (changedB) {
    changedB = false;
    for (const prev of previousNodes) {
      if (claimedPrevIds.has(prev.id)) continue;

      const candidates = unmatched.filter((u) => isExactMatch(prev.fingerprint, u.fingerprint));
      if (candidates.length === 0) continue;

      const prevIdx = previousNodes.findIndex((p) => p.id === prev.id);
      const lo = slotLowBound(previousNodes, claimedPrevIds, pinned, prevIdx);
      const hi = slotHighBound(previousNodes, claimedPrevIds, pinned, prevIdx);

      let inRange: UnmatchedEntry[];
      if (lo + 1 < hi) {
        inRange = candidates.filter((c) => c.position > lo && c.position < hi);
      } else if (lo > hi) {
        inRange = candidates; // inverted: anchors swapped, full pos-distance
      } else {
        inRange = []; // empty slot
      }
      if (inRange.length === 0) continue;

      const origPos = prev.fingerprint.position;
      let best = inRange[0];
      let bestDist = Math.abs(best.position - origPos);
      for (const c of inRange) {
        const d = Math.abs(c.position - origPos);
        if (d < bestDist) {
          best = c;
          bestDist = d;
        }
      }

      claimedPrevIds.add(prev.id);
      pinned.push({
        id: prev.id,
        position: best.position,
        fingerprint: best.fingerprint,
        block: best.block,
        mutation: origPos !== best.position ? 'moved' : 'unchanged',
      });
      const idx = unmatched.indexOf(best);
      unmatched.splice(idx, 1);
      changedB = true;
    }
  }
}

// ----------------------------------------------------------------------
// Split rule — N-way
// ----------------------------------------------------------------------
function applySplitRule(
  unmatched: UnmatchedEntry[],
  previousNodes: NodeEntry[],
  claimedPrevIds: Set<string>,
  pinned: PinnedEntry[],
): void {
  let progress = true;
  while (progress) {
    progress = false;

    for (const orphan of previousNodes) {
      if (claimedPrevIds.has(orphan.id)) continue;
      const orphanSents = orphan.fingerprint.sentences;
      if (!orphanSents || orphanSents.length < 2) continue;

      let claimed = false;
      for (let startIdx = 0; startIdx < unmatched.length && !claimed; startIdx++) {
        const start = unmatched[startIdx];
        if (start.fingerprint.type !== orphan.fingerprint.type) continue;

        const group = [startIdx];
        let concatLen = start.fingerprint.sentences.length;

        for (let next = startIdx + 1; next < unmatched.length; next++) {
          const prev = unmatched[next - 1];
          const cur = unmatched[next];
          if (cur.position !== prev.position + 1) break;
          if (cur.fingerprint.type !== orphan.fingerprint.type) break;

          group.push(next);
          concatLen += cur.fingerprint.sentences.length;

          if (concatLen > orphanSents.length) break;
          if (concatLen < orphanSents.length) continue;

          const concat: string[] = [];
          for (const gi of group) concat.push(...unmatched[gi].fingerprint.sentences);
          if (!sentenceArraysEqual(concat, orphanSents)) break;

          claimedPrevIds.add(orphan.id);
          for (let i = 0; i < group.length; i++) {
            const c = unmatched[group[i]];
            pinned.push({
              id: i === 0 ? orphan.id : generateNodeId(),
              position: c.position,
              fingerprint: c.fingerprint,
              block: c.block,
              mutation: i === 0 ? 'split-first' : `split-${i + 1}`,
            });
          }
          for (let i = group.length - 1; i >= 0; i--) unmatched.splice(group[i], 1);
          claimed = true;
          progress = true;
          break;
        }
      }
    }
  }
}

// ----------------------------------------------------------------------
// Merge rule — N-way
// ----------------------------------------------------------------------
function applyMergeRule(
  unmatched: UnmatchedEntry[],
  previousNodes: NodeEntry[],
  claimedPrevIds: Set<string>,
  pinned: PinnedEntry[],
): void {
  let progress = true;
  while (progress) {
    progress = false;

    for (let ui = 0; ui < unmatched.length; ui++) {
      const candidate = unmatched[ui];
      const candidateSents = candidate.fingerprint.sentences;
      if (!candidateSents || candidateSents.length < 2) continue;

      let merged = false;
      for (let startOrphIdx = 0; startOrphIdx < previousNodes.length && !merged; startOrphIdx++) {
        const start = previousNodes[startOrphIdx];
        if (claimedPrevIds.has(start.id)) continue;
        if (start.fingerprint.type !== candidate.fingerprint.type) continue;

        const group = [startOrphIdx];
        let concatLen = start.fingerprint.sentences.length;

        for (let next = startOrphIdx + 1; next < previousNodes.length; next++) {
          const prev = previousNodes[next - 1];
          const cur = previousNodes[next];
          if (claimedPrevIds.has(cur.id)) break;
          if (cur.fingerprint.type !== candidate.fingerprint.type) break;
          if (cur.fingerprint.position !== prev.fingerprint.position + 1) break;

          group.push(next);
          concatLen += cur.fingerprint.sentences.length;

          if (concatLen > candidateSents.length) break;
          if (concatLen < candidateSents.length) continue;

          const concat: string[] = [];
          for (const gi of group) concat.push(...previousNodes[gi].fingerprint.sentences);
          if (!sentenceArraysEqual(concat, candidateSents)) break;

          for (const gi of group) claimedPrevIds.add(previousNodes[gi].id);
          pinned.push({
            id: previousNodes[group[0]].id,
            position: candidate.position,
            fingerprint: candidate.fingerprint,
            block: candidate.block,
            mutation: `merge-${group.length}-way`,
          });
          unmatched.splice(ui, 1);
          merged = true;
          progress = true;
          ui--;
          break;
        }
      }
      if (merged) break;
    }
  }
}

// ----------------------------------------------------------------------
// Type-change rule (TipTap convention)
// ----------------------------------------------------------------------
function applyTypeChangeRule(
  unmatched: UnmatchedEntry[],
  previousNodes: NodeEntry[],
  claimedPrevIds: Set<string>,
  pinned: PinnedEntry[],
): void {
  let progress = true;
  while (progress) {
    progress = false;

    for (let ui = 0; ui < unmatched.length; ui++) {
      const candidate = unmatched[ui];

      const candidateOrphans = previousNodes.filter((p) => {
        if (claimedPrevIds.has(p.id)) return false;
        if (p.fingerprint.type === candidate.fingerprint.type) return false;
        if (!isSameContent(p.fingerprint, candidate.fingerprint)) return false;
        const orphanIdx = previousNodes.findIndex((x) => x.id === p.id);
        const lo = slotLowBound(previousNodes, claimedPrevIds, pinned, orphanIdx);
        const hi = slotHighBound(previousNodes, claimedPrevIds, pinned, orphanIdx);
        return candidate.position > lo && candidate.position < hi;
      });

      if (candidateOrphans.length === 0) continue;

      const origPos = candidate.position;
      let best = candidateOrphans[0];
      let bestDist = Math.abs(best.fingerprint.position - origPos);
      for (const o of candidateOrphans) {
        const d = Math.abs(o.fingerprint.position - origPos);
        if (d < bestDist) {
          best = o;
          bestDist = d;
        }
      }

      claimedPrevIds.add(best.id);
      pinned.push({
        id: best.id,
        position: candidate.position,
        fingerprint: candidate.fingerprint,
        block: candidate.block,
        mutation: `type-change-${best.fingerprint.type}-to-${candidate.fingerprint.type}`,
      });
      unmatched.splice(ui, 1);
      progress = true;
      ui--;
    }
  }
}

// ----------------------------------------------------------------------
// Edit rule — content drifted, but at least one sentence tuple still matches
// ----------------------------------------------------------------------
function applyEditRule(
  unmatched: UnmatchedEntry[],
  previousNodes: NodeEntry[],
  claimedPrevIds: Set<string>,
  pinned: PinnedEntry[],
): void {
  const unmatchedByPos = [...unmatched].sort((a, b) => a.position - b.position);
  for (const candidate of unmatchedByPos) {
    if (!unmatched.includes(candidate)) continue;

    const candidateOrphans = previousNodes.filter((p) => {
      if (claimedPrevIds.has(p.id)) return false;
      if (p.fingerprint.type !== candidate.fingerprint.type) return false;
      if (!shareAnySentenceTuple(p.fingerprint.sentences, candidate.fingerprint.sentences)) return false;
      const orphanIdx = previousNodes.findIndex((x) => x.id === p.id);
      const lo = slotLowBound(previousNodes, claimedPrevIds, pinned, orphanIdx);
      const hi = slotHighBound(previousNodes, claimedPrevIds, pinned, orphanIdx);
      return candidate.position > lo && candidate.position < hi;
    });

    if (candidateOrphans.length !== 1) continue;

    const orphan = candidateOrphans[0];
    claimedPrevIds.add(orphan.id);
    pinned.push({
      id: orphan.id,
      position: candidate.position,
      fingerprint: candidate.fingerprint,
      block: candidate.block,
      mutation: 'edited',
    });
    const idx = unmatched.indexOf(candidate);
    unmatched.splice(idx, 1);
  }
}

// ----------------------------------------------------------------------
// Slot-continuity fallback
// ----------------------------------------------------------------------
function applySlotContinuityRule(
  unmatched: UnmatchedEntry[],
  previousNodes: NodeEntry[],
  claimedPrevIds: Set<string>,
  pinned: PinnedEntry[],
  graveyard: NodeEntry[],
): void {
  let progress = true;
  while (progress) {
    progress = false;

    for (let ui = 0; ui < unmatched.length; ui++) {
      const candidate = unmatched[ui];

      // Skip candidates that carry an explicit ID already known to the
      // identity graph (in previousNodes or graveyard). Such IDs are real
      // signals — the load-time matcher's previous pin, a restored snapshot,
      // or a paste-back from graveyard. Don't override them with positional
      // guessing; let applyInsertRule preserve them (for previousNodes hits)
      // or applyGraveyardRestoreRule restore them (for graveyard hits).
      //
      // Transient IDs (not in either set — e.g. a fresh ID typed in the
      // editor by a user replacing a block in place) still go through
      // slot-continuity per the "slot is innocent" principle.
      //
      // adr: adr/node-identity-matcher.md
      if (candidate.block.id) {
        const id = candidate.block.id;
        const inPrev = previousNodes.some((p) => p.id === id);
        const inGrave = graveyard.some((g) => g.id === id);
        if (inPrev || inGrave) continue;
      }

      const matchingOrphans = previousNodes.filter((orphan) => {
        if (claimedPrevIds.has(orphan.id)) return false;
        if (orphan.fingerprint.type !== candidate.fingerprint.type) return false;

        const orphanIdx = previousNodes.findIndex((x) => x.id === orphan.id);
        const prevAnchor = findPinnedNeighbor(previousNodes, claimedPrevIds, orphanIdx, -1);
        const nextAnchor = findPinnedNeighbor(previousNodes, claimedPrevIds, orphanIdx, +1);
        const prevNewPos = prevAnchor ? findPinnedPosition(pinned, prevAnchor.id) : -1;
        const nextNewPos = nextAnchor ? findPinnedPosition(pinned, nextAnchor.id) : Infinity;

        return candidate.position > prevNewPos && candidate.position < nextNewPos;
      });

      if (matchingOrphans.length === 0) continue;

      const scored = matchingOrphans.map((orphan) => ({
        orphan,
        score: sentenceSignalOverlapScore(orphan.fingerprint, candidate.fingerprint),
      }));
      scored.sort((a, b) => b.score - a.score);

      const topScore = scored[0].score;

      const tied = scored.filter((s) => s.score === topScore);
      if (tied.length > 1 && topScore === 0) continue;

      let best = tied[0].orphan;
      let bestDist = Math.abs(best.fingerprint.position - candidate.position);
      for (const t of tied) {
        const d = Math.abs(t.orphan.fingerprint.position - candidate.position);
        if (d < bestDist) {
          best = t.orphan;
          bestDist = d;
        }
      }

      claimedPrevIds.add(best.id);
      pinned.push({
        id: best.id,
        position: candidate.position,
        fingerprint: candidate.fingerprint,
        block: candidate.block,
        mutation: 'slot-preserved',
      });
      unmatched.splice(ui, 1);
      ui--;
      progress = true;
    }
  }
}

/**
 * Lightweight content overlap signal used by slot-continuity scoring to
 * disambiguate between multiple candidate orphans in the same slot range.
 *
 * Per sentence pair across both blocks: +1 for each hash that appears in
 * both arrays. Since hashes fold sentence text + terminator together, this
 * counts the number of fully-shared sentences between the two blocks — the
 * matcher's only meaningful similarity question.
 */
function sentenceSignalOverlapScore(a: Fingerprint, b: Fingerprint): number {
  if (!a.sentences || !b.sentences) return 0;
  const seen = new Set(a.sentences);
  let score = 0;
  for (const h of b.sentences) {
    if (seen.has(h)) score++;
  }
  return score;
}

// ----------------------------------------------------------------------
// Graveyard restore
// ----------------------------------------------------------------------
function applyGraveyardRestoreRule(
  unmatched: UnmatchedEntry[],
  graveyard: NodeEntry[],
  claimedGraveIds: Set<string>,
  pinned: PinnedEntry[],
): void {
  for (let ui = unmatched.length - 1; ui >= 0; ui--) {
    const candidate = unmatched[ui];

    const ghostMatches = graveyard.filter(
      (g) => !claimedGraveIds.has(g.id) && isExactMatch(g.fingerprint, candidate.fingerprint),
    );
    if (ghostMatches.length === 0) continue;

    const candPos = candidate.position;
    let best = ghostMatches[0];
    let bestDist = Math.abs(best.fingerprint.position - candPos);
    for (const g of ghostMatches) {
      const d = Math.abs(g.fingerprint.position - candPos);
      if (d < bestDist) {
        best = g;
        bestDist = d;
      }
    }

    claimedGraveIds.add(best.id);
    pinned.push({
      id: best.id,
      position: candidate.position,
      fingerprint: candidate.fingerprint,
      block: candidate.block,
      mutation: 'graveyard-restore',
    });
    unmatched.splice(ui, 1);
  }
}

// ----------------------------------------------------------------------
// Insert rule (last resort)
// ----------------------------------------------------------------------
function applyInsertRule(
  unmatched: UnmatchedEntry[],
  pinned: PinnedEntry[],
  previousNodes: NodeEntry[],
  claimedPrevIds: Set<string>,
  graveyard: NodeEntry[],
  claimedGraveIds: Set<string>,
): void {
  for (let i = unmatched.length - 1; i >= 0; i--) {
    const candidate = unmatched[i];
    // Preserve an existing block ID if the TipTap node already carried one
    // (e.g. agent-assigned via applyChangesToDocument, or freshly minted by
    // the doc-update path). Minting a new ID here would diverge the server
    // copy from the browser copy — the browser still has the original ID,
    // so subsequent updates targeting the new ID can't be resolved and the
    // browser's autosave later overwrites server state with stale content.
    //
    // If the preserved ID also lives in previousNodes or the graveyard, we
    // must claim it from those sets so the same ID doesn't simultaneously
    // appear in pinned AND in orphaned/remaining-graveyard. Without claiming,
    // bb000001 would end up listed in both `nodes:` and `graveyard:` in the
    // output frontmatter — the matcher's identity invariant says an ID lives
    // in exactly one place.
    //
    // If the preserved ID is already claimed (another block earlier in this
    // pass took it, e.g. an exact-match), fall back to a fresh ID to keep IDs
    // globally unique.
    //
    // adr: adr/node-identity-matcher.md
    let id: string;
    const preservedId = candidate.block.id;
    if (
      preservedId &&
      !claimedPrevIds.has(preservedId) &&
      !claimedGraveIds.has(preservedId)
    ) {
      id = preservedId;
      if (previousNodes.some((p) => p.id === preservedId)) claimedPrevIds.add(preservedId);
      if (graveyard.some((g) => g.id === preservedId)) claimedGraveIds.add(preservedId);
    } else {
      id = generateNodeId();
    }
    pinned.push({
      id,
      position: candidate.position,
      fingerprint: candidate.fingerprint,
      block: candidate.block,
      mutation: 'inserted',
    });
    unmatched.splice(i, 1);
  }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
function findPinnedNeighbor(
  previousNodes: NodeEntry[],
  claimedPrevIds: Set<string>,
  startIdx: number,
  direction: 1 | -1,
): NodeEntry | null {
  for (let i = startIdx + direction; i >= 0 && i < previousNodes.length; i += direction) {
    if (claimedPrevIds.has(previousNodes[i].id)) return previousNodes[i];
  }
  return null;
}

function findPinnedPosition(pinned: PinnedEntry[], id: string): number {
  const entry = pinned.find((p) => p.id === id);
  return entry ? entry.position : -1;
}

function slotLowBound(
  previousNodes: NodeEntry[],
  claimedPrevIds: Set<string>,
  pinned: PinnedEntry[],
  orphanIdx: number,
): number {
  const prev = findPinnedNeighbor(previousNodes, claimedPrevIds, orphanIdx, -1);
  return prev ? findPinnedPosition(pinned, prev.id) : -1;
}

function slotHighBound(
  previousNodes: NodeEntry[],
  claimedPrevIds: Set<string>,
  pinned: PinnedEntry[],
  orphanIdx: number,
): number {
  const next = findPinnedNeighbor(previousNodes, claimedPrevIds, orphanIdx, +1);
  return next ? findPinnedPosition(pinned, next.id) : Infinity;
}

function shareAnySentenceTuple(a: string[], b: string[]): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const seen = new Set(a);
  for (const sb of b) {
    if (seen.has(sb)) return true;
  }
  return false;
}
