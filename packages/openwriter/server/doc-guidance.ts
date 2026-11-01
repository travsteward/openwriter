/**
 * Format contracts for typed documents, delivered with the document. The first time an agent
 * session touches a document of a contracted type, the tool result carries the contract in full;
 * after that, a one-line reminder naming it. The contracts are the files in ./guidance, each with
 * a version in its frontmatter. adr: adr/in-system-guidance.md
 *
 * Node built-ins only: the client-mode MCP proxy imports GUIDANCE_NOTICE from here.
 */

import { readFileSync } from 'fs';

/** Which contracts each content_type receives, in reading order, and what the document is called. */
const CONTRACTS: Record<string, { names: string[]; noun: string }> = {
  tweet: { names: ['tweet', 'x-post', 'thread'], noun: 'an X tweet' },
  reply: { names: ['reply', 'x-post', 'thread'], noun: 'an X reply' },
  quote: { names: ['quote', 'x-post', 'thread'], noun: 'an X quote' },
  article: { names: ['article'], noun: 'an X article' },
  blog: { names: ['blog', 'long-form'], noun: 'a blog post' },
  newsletter: { names: ['newsletter', 'long-form'], noun: 'a newsletter issue' },
};

/** That documents carry their guidance. Embedders append it to their own agent's instructions. */
export const GUIDANCE_NOTICE = 'Every document carries editing guidance, including when an optional review note helps. X documents, blog posts and newsletter issues also have format contracts. A book is a workspace set to Book: create_workspace, then configure_book_workspace with workspaceType "book", createBrief and createOutline. Setting one up, or touching any of its documents, delivers the book guidance (how OpenWriter\'s book pieces work, the rules that always hold, writing in the writer\'s voice, editing and other help), the step-by-step book method unless the writer chose to lead, the attached brief and the writer\'s voice status; changed briefs, linked sources or settings refresh that context. The first touch in an agent session delivers unseen contracts in full; later touches carry a reminder.';

/**
 * The local MCP server's instructions: what an agent on the writer's own computer needs before it
 * first touches a document, then GUIDANCE_NOTICE. Not for embedders: a hosted chat has its own
 * instructions, no browser of the writer's to disturb, and get_doc_link answers with an address
 * that only works on the machine running OpenWriter.
 */
export const LOCAL_AGENT_NOTICE = `OpenWriter is the user's writing surface. Writing meant for the user (drafts, rewrites, outlines) goes into a document, where each change arrives as a proposal the user accepts or rejects; chat is for discussing it. The user reviews in their own browser, which shows one open document for every tab, so opening the editor in a browser yourself moves their view: work through the tools. When you mention a document, give the link get_doc_link returns. ${GUIDANCE_NOTICE}`;

interface Contract { name: string; version: number; body: string }

const loaded = new Map<string, Contract>();

function contract(name: string): Contract {
  let c = loaded.get(name);
  if (!c) {
    const raw = readFileSync(new URL(`./guidance/${name}.md`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const m = /^---\nversion: (\d+)\n---\n/.exec(raw);
    if (!m) throw new Error(`guidance/${name}.md has no version frontmatter`);
    c = { name, version: Number(m[1]), body: raw.slice(m[0].length).trim() };
    loaded.set(name, c);
  }
  return c;
}

/** Contracts already sent in full, per agent session, as name@version. */
const delivered = new Map<string, Set<string>>();

/**
 * The guidance for one touch of a document by one agent session: the contracts not yet sent in
 * this session in full, or a one-line reminder when all were. Editing applies to every type.
 */
export function guidanceFor(session: string, docId: string, contentType: string | undefined, bookRole?: string, guided = false): string | null {
  const entry = (contentType ? CONTRACTS[contentType] : undefined) ?? { names: [], noun: 'a document' };
  const bookNames = bookRole ? ['book', ...(guided ? ['book-method'] : []), ...(['brief', 'outline', 'manuscript'].includes(bookRole) ? [`book-${bookRole}`] : [])] : [];
  const contracts = [...entry.names, ...bookNames, 'editing'].map(contract);
  let sent = delivered.get(session);
  if (!sent) delivered.set(session, sent = new Set());
  const fresh = contracts.filter((c) => !sent.has(`${c.name}@${c.version}`));
  for (const c of fresh) sent.add(`${c.name}@${c.version}`);
  const label = contracts.map((c) => `${c.name} v${c.version}`).join(', ');
  if (fresh.length === 0) {
    return `[OpenWriter: ${docId} is ${entry.noun}. Its guidance (${label}) arrived earlier in this session and applies.]`;
  }
  const earlier = contracts.filter((c) => !fresh.includes(c)).map((c) => `${c.name} v${c.version}`);
  const header = `[OpenWriter guidance for ${docId}, ${entry.noun}: ${label}.${earlier.length ? ` Sent earlier in this session: ${earlier.join(', ')}.` : ''}]`;
  return [header, ...fresh.map((c) => c.body)].join('\n\n');
}
