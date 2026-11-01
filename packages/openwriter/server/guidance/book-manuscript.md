---
version: 3
---
## Book manuscript

This is the independent book text built from its outline. It has variantType manuscript and masterDocId pointing to the outline. Edits to source documents or the outline do not update this text. Editing, author review and book downloads happen here. Downloads use accepted text; pending changes are proposals, not published prose.

### Editing

Editing covers whatever scope the writer asks for, from a full developmental pass to a light proofread of one page, and the passes below are a menu, not a sequence the writer must sit through. A pass reads its scope continuously, the way a reader meets it, since seams only show in assembled text. Each pass lands as pending changes, ideally with a short review note where a choice is not obvious. Once the writer has reviewed a pass, a saved version (create_checkpoint) gives a restore point before the next. Edits keep the writer's words and style; a passage is rewritten rather than edited only when the writer asks.

Passes, in the order they usually help when the writer wants several:

- Structure and flow: what each part is for, whether the order works, where the reader loses the thread.
- Claims: for factual writing, each claim checked against sources the agent read, the chapter's links, research notes and the brief's evidence. Tightening that keeps the point is proposed with its source; an unsupported detail is softened or cut rather than replaced from memory; a finding that undercuts the writer's point goes to the writer.
- Openings: whether each chapter's start gives the reader a reason to keep going. Options can be offered; openings drawn from the writer's own life come from the writer.
- Cuts: material whose removal loses nothing the reader needs, such as a repeat of a point made better elsewhere, setup nothing later uses, signposting, and over-explanation. Examples that make an idea concrete, anything a later passage calls back to, and the writer's own stories stay. For more than a few small cuts, the list goes to the writer first, tagged by kind, before cuts are proposed.
- Line editing: repetition, clarity, terms explained where a reader new to them first meets them, smoother handoffs between paragraphs, in the writer's style.
- Consistency: names, terms, facts, timeline and continuity across chapters.
- Drift: the text compared with the writer's original, flagging any edit that moved the writer's meaning, with the original wording to restore.
- Proofreading: spelling, punctuation and typos only.

### Comments

When the writer leaves comments, they are worked top to bottom, one at a time: what the comment asks, one recommendation with its exact wording, staged once the writer approves. The writer's own suggestions are discussed before anything is staged. A comment is resolved once its fix is accepted or the writer agrees no change is needed, never while a question is open.

### Building and adding chapters

The existing outline and manuscript remain connected. add_chapter_to_manuscript brings a newly available outline chapter into this manuscript as one pending change. Rebuilding the whole book is not the way to apply an ordinary edit or append one chapter. The original-version and revision tools preserve recoverable versions.
