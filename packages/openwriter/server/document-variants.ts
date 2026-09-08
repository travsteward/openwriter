import { existsSync, readFileSync } from 'fs';
import { markdownToTiptap, tiptapToMarkdownChecked } from './markdown.js';
import { deriveContentType, resolveTypeMeta } from './content-type-meta.js';
import { save, cancelDebouncedSave, setActiveDocument, getDocument, getTitle, type PadDocument } from './state.js';
import { resolveDocPath, filePathForTitle, generateNodeId, ensureDataDir, atomicWriteFileSync } from './helpers.js';
import { filenameByDocId, switchDocument } from './documents.js';
import { createRevision } from './document-revisions.js';

// Formats whose editable headline is stored as the document title.
const TITLE_BEARING_TYPES = new Set(['blog', 'article', 'newsletter']);

/**
 * Create a variant of `masterFilename` retyped as `variantType`, nested under
 * the master. Field-projection model (NOT a verbatim clone — that's
 * duplicateDocument): port the fields the two types share.
 *  - body: always ported.
 *  - downcast (title-bearing master → body-only variant): the master's title is
 *    folded into the body as its first paragraph so the headline isn't lost.
 *  - the variant is scaffolded with the TARGET type's content_type + context;
 *    the source's context objects (blogContext, tweetContext, …) are NOT
 *    inherited — a variant is a new typed doc, not a surface clone.
 * adr: adr/document-variants.md
 */
export function createVariant(
  masterFilename: string,
  opts: { masterDocId: string; variantType: string },
): { document: PadDocument; title: string; filename: string } {
  cancelDebouncedSave();
  save();

  if (opts.variantType === 'revision') {
    if (filenameByDocId(opts.masterDocId) !== masterFilename) throw new Error('The revision source does not match its parent.');
    const revision = createRevision(opts.masterDocId);
    return switchDocument(revision.filename);
  }

  const sourcePath = resolveDocPath(masterFilename);
  if (!existsSync(sourcePath)) throw new Error(`Document not found: ${masterFilename}`);

  const raw = readFileSync(sourcePath, 'utf-8');
  const parsed = markdownToTiptap(raw);
  const srcType = deriveContentType(parsed.metadata) || 'document';
  const tgtType = opts.variantType;
  const srcTitleBearing = TITLE_BEARING_TYPES.has(srcType);
  const tgtTitleBearing = TITLE_BEARING_TYPES.has(tgtType);

  // Body projection. Downcast (title-bearing → body-only): prepend the master's
  // title as the first paragraph so the headline survives in a surface with no
  // title field ("title becomes first line, body the next paragraph"). Otherwise
  // the body ports unchanged.
  let bodyContent = parsed.document.content || [];
  if (srcTitleBearing && !tgtTitleBearing && parsed.title) {
    bodyContent = [
      { type: 'paragraph', content: [{ type: 'text', text: parsed.title }] },
      ...bodyContent,
    ];
  }
  const bodyDoc = { ...parsed.document, content: bodyContent } as PadDocument;

  // Title is always label-suffixed: it doubles as the filename + sidebar name,
  // so it must stay unique vs the master (a raw duplicate title would collide).
  // The title CONTENT still rides along for title-bearing targets — they render
  // it as the headline and the user trims the suffix.
  const Label = tgtType.charAt(0).toUpperCase() + tgtType.slice(1);
  let newTitle = `${parsed.title} (${Label})`;
  let filePath = filePathForTitle(newTitle);
  if (existsSync(filePath)) {
    let counter = 2;
    while (existsSync(filePathForTitle(`${parsed.title} (${Label} ${counter})`))) counter++;
    newTitle = `${parsed.title} (${Label} ${counter})`;
    filePath = filePathForTitle(newTitle);
  }

  // Fresh metadata: target type scaffold + variant relationship only. Source
  // context objects are intentionally dropped (see header).
  const metadata: Record<string, any> = {
    title: newTitle,
    docId: generateNodeId(),
    ...(resolveTypeMeta(tgtType) || {}),
    masterDocId: opts.masterDocId,
    variantType: tgtType,
  };

  setActiveDocument(bodyDoc, newTitle, filePath, false, undefined, metadata);
  const { markdown } = tiptapToMarkdownChecked(bodyDoc, newTitle, metadata);
  ensureDataDir();
  atomicWriteFileSync(filePath, markdown);

  const newFilename = filePath.split(/[/\\]/).pop()!;
  return { document: getDocument(), title: getTitle(), filename: newFilename };
}
