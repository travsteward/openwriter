/**
 * get_voice: the writer's voice as the writing prompt a fresh drafting context writes against.
 * The prompt follows the Author's Voice skill's skeleton (anchor blend, style repairs, coined
 * terms, the writer's own paragraphs, TASK), filled from what Learn my voice built or the
 * hand-kept voice files. Read-only: no model call, no change to the voice. adr: adr/authors-voice.md
 */

import { z } from 'zod';
import type { ToolDef } from '../mcp.js';
import { readProfile } from './profile/build.js';
import { buildAnchorBlock, buildCoinedTermsBlock, loadVoiceProfile, renderVariationDirective } from './editor/prompt.js';
import { retrieveVoice } from './voice/voice-retrieve.js';
import { learnedDocuments, readVoiceFile, voiceStatusLine } from './voice-status.js';

const bullets = (items: string[]) => items.map((s) => String(s).trim()).filter(Boolean).map((s) => `- ${s}`).join('\n');

/** The skill's skeleton, filled from the writer's voice; null when there is no voice to write in. */
export async function voiceForWriting(about: string, docId?: string): Promise<string | null> {
  const profile = loadVoiceProfile();
  const built = readProfile()?.guidelines?.author_voice_guidelines;
  const neverFile = readVoiceFile('never-rules.md');
  const avoid = built?.avoid ? [...built.avoid.diction, ...built.avoid.syntax, ...built.avoid.punctuation] : [];
  const g = profile.guidelines?.author_voice_guidelines;

  let examples: string[] = [];
  try {
    if (learnedDocuments()) {
      const rag = await retrieveVoice(about);
      examples = rag.examples.filter((e) => e.authenticity === 'Human' && e.documentId !== docId).map((e) => `"${e.context}"`);
    }
  } catch { /* no index on this computer: the profile alone */ }

  const anchor = buildAnchorBlock(profile.anchorBlend)
    || (profile.anchorText ? `You write at this exact training-data blend:\n\n${profile.anchorText}\n\nMaintain these proportions across the output. The blend IS the voice. Do not soften toward generic literary register. Do not default to your own RLHF-trained voice.` : '');
  const repairs = [
    neverFile || bullets(avoid),
    g?.fingerprints?.length ? `Presentation fingerprints, kept exactly:\n${bullets(g.fingerprints)}` : '',
    g?.signature?.length ? `AUTHOR'S REAL VOICE — EXCEPTIONS TO THE RULES ABOVE: The following are the author's genuine habits, not AI tells. Where a rule above conflicts with one of these, the author's habit wins:\n${bullets(g.signature)}` : '',
    renderVariationDirective(g?.sentence_distribution),
  ].filter(Boolean);
  const coined = buildCoinedTermsBlock(profile.coinedTerms);
  if (!anchor && !repairs.length && !coined && !examples.length) return null;

  return [
    anchor,
    repairs.length ? `STYLE REPAIRS — apply these as hard constraints:\n\n${repairs.join('\n\n')}` : '',
    coined ? `CONTENT — preserve these coined terms verbatim:\n\n${coined}` : '',
    examples.length ? `REFERENCE EXAMPLES OF AUTHOR'S WRITING (use if helpful — content and style):\n\n${examples.join('\n\n')}` : '',
    '---',
    'TASK:\n\n{TASK}',
    'Return prose only. No commentary. No diff. No explanation. No headers. No markdown wrapping.',
  ].filter(Boolean).join('\n\n');
}

export const voiceTools: ToolDef[] = [{
  name: 'get_voice',
  description: 'The writer\'s voice, as a writing prompt for drafting one passage in it: the author blend their prose matches, their avoidance rules, presentation fingerprints, real habits, sentence rhythm and coined terms (from Learn my voice or hand-kept voice files), then their own paragraphs closest to the passage. The prompt ends in a TASK slot for the passage\'s commitments and is meant for a fresh drafting context, such as the openwriter-ghostwriter subagent. Read-only, no model call. Without a learned voice it says how the writer sets one up.',
  schema: {
    about: z.string().min(1).describe('What the passage must accomplish: its beat commitments or a short summary. Used to find the writer\'s closest paragraphs.'),
    docId: z.string().optional().describe('The document the passage goes into; its own paragraphs are never returned as examples.'),
  },
  handler: async ({ about, docId }: { about: string; docId?: string }) => {
    const prompt = await voiceForWriting(about, docId);
    const status = voiceStatusLine();
    return { content: [{ type: 'text', text: prompt ? `${status}\n\n${prompt}` : `${status} There is no voice to write in yet, so a draft would carry the model's default style.` }] };
  },
}];
