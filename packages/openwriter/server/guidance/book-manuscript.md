---
version: 2
---
## Book manuscript

This is the independent book text built from its outline. It has variantType manuscript and masterDocId pointing to the outline. Edits to source beats or the outline do not update this text. Editing, author review and book downloads happen here. Downloads use accepted text; pending changes are proposals, not published prose.

### The editing pass

An editing pass works one chapter at a time, read continuously the way the reader meets it; seams only show in the assembled text. Before any claim is questioned, the chapter's sources are gathered: its links, citations, linked research notes and the brief's evidence sources. The stages run in order, each landing as pending changes; once the author has reviewed a stage, a version is saved (create_checkpoint) before the next begins, so nothing builds on unreviewed edits.

1. Claims. Each factual claim is checked against sources the agent read. Tightening that keeps the argument is proposed with its source in a review note; an unsupported detail is softened or cut rather than replaced from memory. A finding that breaks the argument goes to the author and changes nothing.
2. Hook. The chapter opens with why the reader should care about what it is about to teach, before it teaches it. The agent offers two or three openings built from the brief's promise; lived openings come from the author.
3. Cruft. Material whose removal loses nothing the reader needs: a repeat of a point made better elsewhere, setup nothing later uses, signposting that says what is coming instead of saying it, and over-explanation of what the reader already understood. Examples that make an idea concrete, anything a later passage calls back to, and the author's own stories stay. The list goes to the author, tagged by kind with its word count, before the cuts are proposed.
4. Sentences. Facts frozen. Repetition inside paragraphs goes, each technical term is explained plainly where it first appears, handoffs between paragraphs are smoothed, and every named person, coined term and experiment is made clear to a lay reader, all in the author's words and style.
5. Drift. The chapter is compared with the author's original, change by change, and any change that moved the author's meaning (who acts, what causes what, a softened point, an imported framing) is flagged with the original wording to restore.
6. Weak points. At most eight beats that still sag, each with keep, fix or cut and whether the fix needs new material from the author. The author decides.

The author's comment pass comes last: the author reads the chapter and leaves comments, which are worked top to bottom, one at a time, each with one recommendation and its exact wording, staged only after the author approves it. The author's own suggestions are discussed before anything is staged. A comment is resolved once its fix is accepted or the author agrees no change is needed, never while a question is open.

### Building and adding chapters

The existing outline and manuscript remain connected. add_chapter_to_manuscript brings a newly available outline chapter into this manuscript as one pending change. Rebuilding the whole book is not the way to apply an ordinary edit or append one chapter. The original-version and revision tools preserve recoverable versions.
