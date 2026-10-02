import { useBookStatus } from './hooks/useBookStatus';

/**
 * A beat whose chapter is already in a book's manuscript says so: the
 * manuscript is the book now, so edits here no longer reach it.
 * adr: adr/manuscript-engine.md
 */
export default function BeatBanner({ docId, onOpen }: { docId: string | null; onOpen: (filename: string) => void }) {
  const [book] = useBookStatus(docId);
  const held = book?.inManuscripts?.[0];
  if (!held) return null;
  return (
    <div className="editor-beat-banner" role="note">
      <span>This beat is already in “{held.title}”. Edits here won't change the book.</span>
      <button type="button" className="editor-beat-banner__open" onClick={() => onOpen(held.filename)}>Open manuscript</button>
    </div>
  );
}
