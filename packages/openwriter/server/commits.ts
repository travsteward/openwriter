/**
 * Version commits — the attributed git-history layer over the version system.
 *
 * A COMMIT is a boundary cut (agent finished writing / human accepted / manual
 * Save-version) that bundles the attributed edit-events recorded since the
 * previous commit into one reviewable unit. The 30s auto-snapshots in
 * versions.ts are demoted to a hidden restore safety-net; commits are what the
 * Versions panel shows as history.
 *
 * This builds entirely on the Phase-1 substrate — it does NOT capture anything
 * new. The `_history/{docId}.jsonl` EditEvents (from attribution.ts) already
 * record which node/sentence changed, by whom, with what op. A commit just
 * delimits a ts-range of that log, rolls it up, and pins a content snapshot.
 *
 * Storage: `_commits/{docId}.jsonl` (append-only, one Commit per line).
 *
 * adr: adr/document-history-attribution.md
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { getDataDir, atomicWriteFileSync } from './helpers.js';
import { readHistory, type Actor, type EditEvent } from './attribution.js';
import { writeSnapshotMarkdown, getVersionContent, pruneVersions } from './versions.js';

export type CommitTrigger = 'agent-finished' | 'accept' | 'manual';

/** Per-actor change tallies within a commit's changeset. */
export interface ActorTally { added: number; edited: number; removed: number; }

export interface CommitChangeset {
  added: number;
  edited: number;
  removed: number;
  byActor: Record<string, ActorTally>;
}

export interface Commit {
  ts: number;             // commit time (and key)
  parent: number | null;  // previous commit ts, or null for the first
  fromTs: number;         // start (exclusive) of the bundled _history range
  trigger: CommitTrigger;
  actors: Actor[];        // distinct actors that contributed to this changeset
  note?: string;          // optional human message (manual commits)
  snapshotTs: number;     // version snapshot capturing this commit's content
  summary: CommitChangeset;
}

function commitsDir(): string { return join(getDataDir(), '_commits'); }
function commitsPath(docId: string): string { return join(commitsDir(), `${docId}.jsonl`); }

/** All commits for a doc, oldest-first (file order). */
export function listCommits(docId: string): Commit[] {
  if (!docId) return [];
  const path = commitsPath(docId);
  if (!existsSync(path)) return [];
  const out: Commit[] = [];
  try {
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      if (!line) continue;
      try {
        const c = JSON.parse(line);
        if (c && typeof c.ts === 'number') out.push(c as Commit);
      } catch { /* skip malformed */ }
    }
  } catch { /* ignore */ }
  return out;
}

function lastCommit(docId: string): Commit | null {
  const all = listCommits(docId);
  return all.length > 0 ? all[all.length - 1] : null;
}

/** Roll a set of EditEvents up into a per-actor changeset tally. */
export function rollupChangeset(events: EditEvent[]): { summary: CommitChangeset; actors: Actor[] } {
  const summary: CommitChangeset = { added: 0, edited: 0, removed: 0, byActor: {} };
  const actorSet = new Set<Actor>();
  for (const e of events) {
    for (const span of e.spans) {
      const actor = span.actor;
      actorSet.add(actor);
      const tally = summary.byActor[actor] || { added: 0, edited: 0, removed: 0 };
      if (span.op === 'add') { summary.added++; tally.added++; }
      else if (span.op === 'edit') { summary.edited++; tally.edited++; }
      else if (span.op === 'remove') { summary.removed++; tally.removed++; }
      summary.byActor[actor] = tally;
    }
  }
  return { summary, actors: Array.from(actorSet) };
}

/**
 * Create a commit at a boundary. Bundles the _history events recorded since the
 * previous commit, rolls them up, pins a content snapshot, and appends the
 * manifest entry. Returns the Commit, or null when there is nothing new to
 * commit (no empty commits). Best-effort callers wrap in try/catch.
 *
 * `markdown` is the current on-disk doc content to snapshot for this commit;
 * `nowTs` is the commit timestamp (pass the save/event time so it's deterministic).
 */
export function commitVersion(
  docId: string,
  markdown: string,
  opts: { trigger: CommitTrigger; actor: Actor; note?: string; nowTs: number },
): Commit | null {
  if (!docId) return null;
  const prev = lastCommit(docId);
  const fromTs = prev ? prev.ts : 0;
  // Bundle the attributed edit-events since the previous commit.
  const events = readHistory(docId).filter((e) => e.ts > fromTs && e.ts <= opts.nowTs);
  if (events.length === 0) return null; // nothing changed since the last commit

  const { summary, actors } = rollupChangeset(events);
  // No net authored change (e.g. only no-op events) — skip.
  if (summary.added + summary.edited + summary.removed === 0) return null;

  // Pin the content for this commit so its diff (vs the parent) is reproducible.
  // writeSnapshotMarkdown dedups identical content; pruneVersions then bounds the
  // snapshot store by the standard retention (max 50 / keep-7-days) — so commit
  // snapshots don't accumulate without limit. The commit manifest is tiny and
  // kept forever; only old unnamed commits' restorable *content* ages out (the
  // panel's `restorable` flag reflects this). A named commit's snapshot is kept.
  // adr: adr/document-history-attribution.md
  const snapshotTs = writeSnapshotMarkdown(docId, markdown);
  pruneVersions(docId);

  const commit: Commit = {
    ts: opts.nowTs,
    parent: prev ? prev.ts : null,
    fromTs,
    trigger: opts.trigger,
    actors,
    snapshotTs,
    summary,
  };
  if (opts.note) commit.note = opts.note;

  try {
    const dir = commitsDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(commitsPath(docId), JSON.stringify(commit) + '\n');
  } catch { return null; }
  return commit;
}

/**
 * The attributed change detail for one commit — the raw events that made it up,
 * resolved against the commit's snapshot so the panel can show the actual
 * changed node text alongside who changed it. Returns null if the commit or its
 * snapshot is gone (pruned).
 */
export function getCommitDetail(docId: string, commitTs: number): {
  commit: Commit;
  parentSnapshotTs: number | null;
  events: EditEvent[];
} | null {
  const all = listCommits(docId);
  const commit = all.find((c) => c.ts === commitTs);
  if (!commit) return null;
  const events = readHistory(docId).filter((e) => e.ts > commit.fromTs && e.ts <= commit.ts);
  return {
    commit,
    parentSnapshotTs: commit.parent ? (all.find((c) => c.ts === commit.parent)?.snapshotTs ?? null) : null,
    events,
  };
}

/** Convenience: does this commit's snapshot still exist on disk (not pruned)? */
export function commitSnapshotAvailable(docId: string, commitTs: number): boolean {
  const c = listCommits(docId).find((x) => x.ts === commitTs);
  return !!(c && getVersionContent(docId, c.snapshotTs) !== null);
}

/**
 * Read a doc's current on-disk content and commit. Thin wrapper used by the
 * trigger sites (agent-finished / accept / manual) so they don't each
 * re-implement the file read. The snapshot is the canonical disk content (the
 * restorable state); the changeset is sourced from the attributed _history
 * events (always correct re: what/who, independent of pending state). Callers
 * pass the filePath directly — commits.ts deliberately does NOT depend on
 * documents.ts/state.ts so the capture sites in state.ts can call into it
 * without an import cycle. Returns null on read failure or nothing-to-commit.
 */
export function commitFromFile(
  docId: string,
  filePath: string,
  opts: { trigger: CommitTrigger; actor: Actor; note?: string; nowTs: number },
): Commit | null {
  if (!docId || !filePath || !existsSync(filePath)) return null;
  let markdown: string;
  try { markdown = readFileSync(filePath, 'utf-8'); } catch { return null; }
  return commitVersion(docId, markdown, opts);
}

/**
 * Debounced agent-finished commit, PER DOC. Called from the capture sites
 * (writeToDisk / flushDocToFile) on every agent write — those are the only
 * places that reliably see EVERY agent edit tool (write_to_pad, populate, etc.)
 * AND know the exact target docId + filePath. A burst of rapid agent writes to
 * one doc coalesces into a single commit (~1.5s). commitFromFile is idempotent
 * (no new events → no-op). adr: adr/document-history-attribution.md
 */
const agentCommitTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function scheduleAgentCommit(docId: string, filePath: string): void {
  if (!docId || !filePath) return;
  const existing = agentCommitTimers.get(docId);
  if (existing) clearTimeout(existing);
  agentCommitTimers.set(docId, setTimeout(() => {
    agentCommitTimers.delete(docId);
    try { commitFromFile(docId, filePath, { trigger: 'agent-finished', actor: 'agent', nowTs: Date.now() }); } catch { /* best-effort */ }
  }, 1500));
}

/** Build a compact one-line changeset label, e.g. "+3 agent · 2 edited you". */
export function summaryLine(summary: CommitChangeset): string {
  const parts: string[] = [];
  for (const actor of Object.keys(summary.byActor)) {
    const t = summary.byActor[actor];
    const bits: string[] = [];
    if (t.added) bits.push(`+${t.added}`);
    if (t.edited) bits.push(`~${t.edited}`);
    if (t.removed) bits.push(`-${t.removed}`);
    if (bits.length) parts.push(`${bits.join(' ')} ${actor === 'human' ? 'you' : actor}`);
  }
  return parts.join(' · ') || 'no changes';
}
