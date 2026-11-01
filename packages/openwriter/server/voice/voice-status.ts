/**
 * One line on the writer's voice for the book guidance: whether drafts can be written in it yet.
 * Reads the profile file and the index directly so the book module can use it without loading
 * the voice actions (they reach the tool list, which loads the book module). adr: adr/authors-voice.md
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getDataDir } from '../helpers.js';
import { voiceIndex } from './voice/voice-index.js';

/** The skill's hand-kept voice files, which win over the learned profile. */
export const HAND_KEPT_FILES = ['anchor.md', 'never-rules.md', 'fingerprints.md', 'stats.md', 'coined-terms.md'];

export const VOICE_SETUP = 'The writer teaches it by right-clicking documents of their own writing and choosing Learn my voice from this; a profile is built once at least 200 words of their own text are in.';

const voiceFolder = () => join(getDataDir(), 'voice');

export function readVoiceFile(name: string): string {
  const p = join(voiceFolder(), name);
  try { return existsSync(p) ? readFileSync(p, 'utf-8').trim() : ''; } catch { return ''; }
}

/** Documents added to the voice; 0 without opening (and so creating) an index that is not there. */
export function learnedDocuments(): number {
  if (!existsSync(join(voiceFolder(), 'index.db'))) return 0;
  return voiceIndex(getDataDir()).status().length;
}

export function voiceStatusLine(): string {
  try {
    const docs = learnedDocuments();
    let profile: any = null;
    try { profile = JSON.parse(readVoiceFile('profile.json') || 'null'); } catch { /* unreadable: no profile */ }
    const handKept = HAND_KEPT_FILES.filter((f) => readVoiceFile(f)).map((f) => f.replace('.md', ''));
    const kept = handKept.length ? ` Hand-kept voice files in use: ${handKept.join(', ')}.` : '';
    if (profile?.analyzedAt) {
      const confidence = profile.guidelines?.author_voice_guidelines?.confidence;
      return `Voice: learned from ${docs} document${docs === 1 ? '' : 's'}, ${Number(profile.analyzedWords).toLocaleString('en-US')} words of the writer's own text${confidence ? `, ${String(confidence).toLowerCase()} confidence` : ''}, built ${String(profile.analyzedAt).slice(0, 10)}. get_voice returns it for drafting.${kept}`;
    }
    if (handKept.length) return `Voice: no profile learned yet.${kept} get_voice returns them for drafting.`;
    if (docs) return `Voice: ${docs} document${docs === 1 ? '' : 's'} added, not yet 200 words of the writer's own text, so no profile yet. ${VOICE_SETUP}`;
    return `Voice: not learned yet. ${VOICE_SETUP}`;
  } catch {
    return 'Voice: status unavailable on this computer.';
  }
}
