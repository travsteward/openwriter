/**
 * Author's Voice's editor pipeline (EditorPromptService.applyEditor), on the writer's key: the
 * system prompt carries voice examples found by the whole document (kept five minutes per
 * document, so the same prompt is replayed and cached), the user prompt carries examples found
 * by the selection and its surroundings, minus the system prompt's. Returns the rewritten
 * Markdown; the caller decides how it reaches the document.
 * adr: adr/authors-voice.md
 */

import { statSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { claude, dataDir, explainApiError, modelSetting, VoiceError, usingBalance } from '../host.js';
import { DEFAULT_REWRITE_MODEL, modelFor, resolveChoice, type ModelChoice } from '../models.js';
import { recordUsage, tokenCounts } from '../usage-log.js';
import {
  addToTextBudget, buildSystemPrompt, buildUserPrompt, computeSizeBudget, generateDocumentQuery,
  generateSearchQuery, getActionInstruction, loadVoiceProfile, maxTokensFor, profileBlocks,
  selectionWordCount, sizeReminderLine, stripSelectionMarkersFromText, voiceDir,
  INSTRUCTION_RAG_SCORING, SYSTEM_RAG_SCORING, type EditorAction, type SizeBudget,
} from './prompt.js';
import { chunkKey, emptyRagResult, retrieveVoice, type GrepRAGResult } from '../voice/voice-retrieve.js';
import { readParagraphs } from '../voice/voice-enrich.js';
import { voiceIndex } from '../voice/voice-index.js';
import { tiptapToBody } from '../../markdown-serialize.js';

const START = '[[START_SELECTION]]';
const END = '[[END_SELECTION]]';
/** Text for comparing an echo: no Markdown punctuation, one space between words, lower case. */
const plainOf = (md: string) => md.replace(/[*_`#>\[\]()~\\]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The rewrite of a partial selection, with the unselected text around it put back exactly as it
 * was. The model sees the whole node with the selection marked; some return the whole node, some
 * only the selection, and taking the second as the first deleted the rest of the paragraph
 * (2026-11-16). So the text before and after the markers is never the model's to keep: a side
 * the model already echoed (its opening or ending matches) is taken as given, any other side is
 * added back. A whole-node selection has no markers and is returned as it came.
 */
export function spliceSelection(nodes: any[], rewritten: string): string {
  const md = tiptapToBody({ type: 'doc', content: nodes }).trim();
  const s = md.indexOf(START);
  const e = md.indexOf(END);
  if (s < 0 || e < s) return rewritten;
  const before = md.slice(0, s);
  const after = md.slice(e + END.length);
  const out = plainOf(rewritten);
  const head = plainOf(before).slice(0, 40);
  const tail = plainOf(after).slice(-40);
  const keepBefore = head !== '' && !out.startsWith(head);
  const keepAfter = tail !== '' && !out.endsWith(tail);
  // The sides keep their own spacing ("months. " before, " Then" after) around the trimmed rewrite.
  return `${keepBefore ? before : ''}${rewritten.trim()}${keepAfter ? after : ''}`;
}

export const MAX_SELECTION_WORDS = 5000;
const MAX_INSTRUCTION_CHARS = 2000;
const EDITOR_ACTIONS: readonly EditorAction[] = ['rewrite', 'shrink', 'expand', 'custom', 'fill', 'fill-sentence', 'insert'];

/** A shortcut wanting more or less than the same length (the web version's phone actions). */
export type LengthHint = 'longer' | 'shorter' | 'add-paragraph' | 'add-sentence';
export const LENGTH_HINTS: readonly LengthHint[] = ['longer', 'shorter', 'add-paragraph', 'add-sentence'];

export interface EditorRequest {
  docId: string;
  nodeIds: string[];
  /** TipTap JSON of the selected nodes; a partial selection carries [[START_SELECTION]] / [[END_SELECTION]]. */
  nodes: any[];
  contextBefore?: string[];
  contextAfter?: string[];
  instruction?: string;
  /** An Author's Voice action (the editor's right-click menu). */
  action?: EditorAction;
  /** Or a length shortcut, mapped to an action below. */
  length?: LengthHint;
  /** opus | sonnet | haiku; the plugin setting when absent. */
  model?: string;
  /** The document's text, when the caller has it (the editor sends it). */
  fullDocument?: string;
}

function validate(req: EditorRequest): void {
  if (typeof req?.docId !== 'string' || !req.docId) throw new VoiceError(400, 'bad_request', 'No document.');
  if (!Array.isArray(req.nodeIds) || req.nodeIds.length === 0 || !req.nodeIds.every((id) => typeof id === 'string' && id)) {
    throw new VoiceError(400, 'bad_request', 'Select some text first.');
  }
  if (!Array.isArray(req.nodes) || req.nodes.length !== req.nodeIds.length) {
    throw new VoiceError(400, 'bad_request', 'The selection did not match the document.');
  }
  if (req.instruction !== undefined && (typeof req.instruction !== 'string' || req.instruction.length > MAX_INSTRUCTION_CHARS)) {
    throw new VoiceError(400, 'bad_request', `Keep the instruction under ${MAX_INSTRUCTION_CHARS} characters.`);
  }
  if (req.length !== undefined && !LENGTH_HINTS.includes(req.length)) throw new VoiceError(400, 'bad_request', 'Unknown length.');
  if (req.action !== undefined && !EDITOR_ACTIONS.includes(req.action)) throw new VoiceError(400, 'bad_request', 'Unknown action.');
}

/**
 * The Author's Voice action for a request. A shortcut maps to its own action (Expand, Shrink,
 * Fill paragraph, Fill sentence) and uses that action's instruction, not the shortcut's wording.
 * Adding a paragraph or a sentence to existing text has no Author's Voice action: it runs as a
 * custom rewrite with the shortcut's instruction and a budget grown by that much.
 */
function editorAction(req: EditorRequest, instruction: string | undefined): { action: EditorAction; budget: SizeBudget; instruction?: string } {
  const plain = (action: EditorAction, guidance?: string) => ({ action, budget: computeSizeBudget(action, req.nodes), instruction: guidance });
  if (req.action) return plain(req.action, instruction);
  const empty = selectionWordCount(req.nodes) === 0;
  switch (req.length) {
    case 'longer': return plain('expand');
    case 'shorter': return plain('shrink');
    case 'add-paragraph': return empty ? plain('fill') : { action: 'custom', budget: addToTextBudget('add-paragraph', req.nodes), instruction };
    case 'add-sentence': return empty ? plain('fill-sentence') : { action: 'custom', budget: addToTextBudget('add-sentence', req.nodes), instruction };
  }
  if (instruction) return plain(empty ? 'insert' : 'custom', instruction);
  return plain('rewrite');
}

// System prompt cache (Author's Voice kept it in Postgres for 5 minutes per document, so a run of
// edits on one document replays the identical prompt and hits Anthropic's prompt cache).
const SYSTEM_PROMPT_TTL_MS = 5 * 60 * 1000;
const systemPromptCache = new Map<string, { prompt: string; chunkIds: string[]; expires: number }>();

/** What the cached prompt was built from: the voice index and the profile files. */
function voiceSignature(): string {
  const files = ['anchor.md', 'coined-terms.md', 'fingerprints.md', 'stats.md', 'profile.json'].map((f) => {
    try { return statSync(join(voiceDir(), f)).mtimeMs; } catch { return 0; }
  });
  return `${voiceIndex(dataDir()).version()}|${files.join(',')}`;
}

async function systemPromptFor(docId: string, fullDocumentIn: string | undefined, instruction: string | undefined): Promise<{ prompt: string; chunkIds: string[] }> {
  // Unlike Author's Voice's cache, a change to the voice (a document added, the profile rebuilt,
  // a profile file edited) is seen at once instead of after five minutes.
  const key = `${dataDir()}|${docId}|${voiceSignature()}`;
  const hit = systemPromptCache.get(key);
  if (hit && hit.expires > Date.now()) return hit;

  const { anchorBlock, coinedTermsBlock, voiceProfile, voiceExceptions } = profileBlocks(loadVoiceProfile());
  let fullDocument = fullDocumentIn ?? '';
  if (fullDocumentIn === undefined) {
    try { fullDocument = (await readParagraphs(docId)).text; } catch { /* no document signal */ }
  }
  // Primary: document-wide query for broad voice signal. Fallback: on an empty document, the
  // instruction, so the prompt still carries examples for what is being written (not cached).
  const docQuery = generateDocumentQuery(fullDocument);
  const usedFallback = docQuery.length === 0 && !!instruction && instruction.trim().length > 0;
  const effectiveQuery = docQuery.length > 0 ? docQuery : (usedFallback ? instruction!.trim() : '');
  const systemRag: GrepRAGResult = effectiveQuery.length > 0
    ? await retrieveVoice(effectiveQuery, { scoring: SYSTEM_RAG_SCORING })
    : emptyRagResult();
  const prompt = buildSystemPrompt(anchorBlock, voiceProfile, coinedTermsBlock, systemRag, fullDocument, voiceExceptions);
  const out = { prompt, chunkIds: systemRag.selectedChunkIds };
  if (!usedFallback) {
    for (const [k, v] of systemPromptCache) if (v.expires <= Date.now()) systemPromptCache.delete(k);
    systemPromptCache.set(key, { ...out, expires: Date.now() + SYSTEM_PROMPT_TTL_MS });
  }
  return out;
}

/**
 * The model a rewrite uses when the request names none: the writer's choice in Settings > Claude,
 * else Haiku on the OpenWriter balance (the free tier) or Opus on their own key.
 */
export function defaultEditorModel(): ModelChoice {
  return resolveChoice(modelSetting(), usingBalance() ? 'haiku' : DEFAULT_REWRITE_MODEL);
}

/**
 * Rewrite the selection in the writer's voice. Returns Markdown, selection markers removed, and
 * the prompts sent (for the prompt-debug inspector, docs/prompt-debug.md).
 */
export async function runEditor(req: EditorRequest): Promise<{
  markdown: string; model: ModelChoice; action: EditorAction; prompts: { systemPrompt: string; userPrompt: string };
}> {
  validate(req);
  const client = claude({ job: 'rewrite' });

  const words = selectionWordCount(req.nodes);
  if (words > MAX_SELECTION_WORDS) {
    throw new VoiceError(413, 'too_large', `Selection too large: ${words.toLocaleString()} words (max ${MAX_SELECTION_WORDS.toLocaleString()}). Select a smaller section.`);
  }

  const choice = resolveChoice(req.model, defaultEditorModel());
  const model = await modelFor(choice);
  const { action, budget, instruction } = editorAction(req, req.instruction?.trim() || undefined);

  const system = await systemPromptFor(req.docId, req.fullDocument, instruction);
  // Selection-level examples: topical, minus the system prompt's, and never the paragraphs being
  // rewritten (an example of the very text would invite copying it).
  const ragQuery = generateSearchQuery(req.nodes, instruction, req.contextBefore, req.contextAfter, action);
  const instructionRag = ragQuery.length > 0
    ? await retrieveVoice(ragQuery, {
        excludeChunkIds: [...system.chunkIds, ...req.nodeIds.map((id) => chunkKey(req.docId, id))],
        scoring: INSTRUCTION_RAG_SCORING,
      })
    : emptyRagResult();
  const user = buildUserPrompt(
    req.nodes, action, getActionInstruction(action, budget, instruction),
    req.contextBefore, req.contextAfter, instructionRag, sizeReminderLine(budget),
  );

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: model.id,
      // A model that takes an effort level thinks by default and spends from the same ceiling.
      max_tokens: maxTokensFor(budget, model.effort),
      system: [{ type: 'text', text: system.prompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      ...(model.effort ? { output_config: { effort: 'low' } } : {}),
    } as Anthropic.MessageCreateParamsNonStreaming);
  } catch (err) {
    recordUsage({ kind: 'inline-edit', model: model.id, docId: req.docId, ...tokenCounts(null), toolCalls: 0, ok: false });
    throw explainApiError(err);
  }

  recordUsage({ kind: 'inline-edit', model: model.id, docId: req.docId, ...tokenCounts(response.usage), toolCalls: 0, ok: response.stop_reason === 'end_turn' });

  if (response.stop_reason === 'refusal') throw new VoiceError(422, 'refused', 'Claude declined to rewrite this passage.');
  if (response.stop_reason === 'max_tokens') throw new VoiceError(422, 'too_long', 'The rewrite ran past its length limit. Try a smaller selection.');

  const answer = stripSelectionMarkersFromText(
    response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n\n'),
  ).trim();
  if (!answer) throw new VoiceError(422, 'empty', 'Claude returned no text.');
  const markdown = spliceSelection(req.nodes, answer);
  return { markdown, model: choice, action, prompts: { systemPrompt: system.prompt, userPrompt: user } };
}
