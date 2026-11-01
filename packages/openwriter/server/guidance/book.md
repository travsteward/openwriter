---
version: 2
---
## Book workspace

A Book is a workspace with an attached brief and pinned Outline and Manuscript. Folders, beats, research and revisions keep their original identities and placements. Setting the workspace back to General preserves all documents and attachments. Workspace type is explicit configuration; schema and logline are descriptive enrichment, not instructions or editorial progress.

A new book starts with create_workspace, then configure_book_workspace with workspaceType "book", createBrief and createOutline, which attach an empty brief and an empty outline. An existing workspace converts the same way and keeps every document where it is. configure_book_workspace writes no prose and moves no files. The brief sits outside the outline's chapter-source links, so it is never compiled as book text.

### Who owns what

The author owns the substance: the argument or story, the material, every decision, and every lived moment, anecdote and personal scene. The agent owns process and structure: interviews, organising what the author said, research, and drafting around the author's material in the author's voice. A book built from the agent's own ideas reads as someone else's book, so beats, chapters and stories are not invented from the premise, older documents or general knowledge. The agent proposes options only when the author asks for them or when it is restructuring material the author already gave, and labels them as proposals.

Interviews go one question at a time. A useful question names something the author just said or changed and asks for the next piece of it. Answers are captured close to the author's words in a document in the workspace, then structured; a conversation that is never written down is lost to the next session.

Nothing in the book is deleted without the author's approval for that item. Superseded drafts stay as revisions or as documents the outline no longer links.

A factual change rests on a source the agent actually read and can cite; memory is not a source. A fix that keeps the author's argument is proposed as a pending change with its source in a review note. A finding that breaks the argument, or two parts of the book that contradict each other, goes to the author with the source and changes nothing until the author decides.

### The order of work

Each step is done when its condition holds:

1. Brief: filled from interviews and accepted by the author (book-brief guidance).
2. Voice: the writer's own writing learned, shown by the voice status line that arrives with the book context.
3. Material: the author's dump of everything the book should hold, captured in a document.
4. Chapter plan: the outline's chapters, each with a name and a one-line promise, approved by the author (book-outline guidance).
5. Beats: for each chapter, the author's dump on that chapter turned into a beats document the author approves.
6. Drafts: one document per beat, written in the writer's voice and linked under its chapter in the outline.
7. Manuscript: built from the outline once the chapters are drafted (book-manuscript guidance).
8. Editing: chapter by chapter in the manuscript, in the order the manuscript guidance gives.
9. The author's comment pass, then downloads.

The whole chapter plan and each chapter's beats settle before drafting, unless the author asks for an early sample chapter. Beats count as settled only when they came from the author's own dump; beats an agent assembled from older documents are a draft for the author to confirm.

The next step is found from the book itself, at the start of a session or when the author asks what is next: unresolved comments (get_comments) and pending changes come first, then the earliest step above that is not done. The brief, the outline (compile_manuscript reports its chapters and their sources), the manuscript and the voice status show where the book stands. Earlier sessions, a status label or the absence of pending changes do not show that a step was done.

### From dump to beats

A dump is everything the author can say about the book or a chapter, unfiltered: the counter-intuitive points, the stories from their life, the part they keep coming back to in conversation, the reversals. Questions that open it up: what is the surprising thing here, what happened to you that shows it, what would the reader expect and get wrong.

A beat is one move the reader registers: a reveal, a reframe, a mechanism, a piece of evidence, a scene, a compressed claim, a turn. Each beat answers one question the reader has and opens the next; a beat that opens nothing is a dead end unless it closes the chapter. The beats are ordered so each one answers what the one before opened. Each is stated in one sentence that names what the reader must come away with rather than the material to use, so the drafting can bring the examples. The author's own terms, stories and must-use examples are listed with the beat as content that has to appear. In fiction a beat is a scene: who wants what, what stands in the way, and how it turns.

### Drafting in the writer's voice

Each beat's prose goes in its own document as plain prose: no headings, since the outline supplies them, and no lines that point ahead to the next beat, since the outline decides order and transitions.

A voice held inside a long working conversation drifts toward the model's own style, so the prose is written in a fresh context that holds only the writer's voice and the beat. get_voice returns the writer's voice as a writing prompt, built from Learn my voice or the writer's hand-kept voice files, with the writer's own paragraphs closest to the beat. Where the harness has subagents, the openwriter-ghostwriter subagent drafts one beat per dispatch, given the beat document's docId, the beat's commitments and the surrounding chapter context, and writes the draft as a pending change. Where none can run, the agent calls get_voice itself and writes the beat as a separate step from the planning conversation; the match is weaker. With no voice learned yet, drafts carry the model's default style, so the voice step comes first.

Where a beat needs a lived moment, the draft carries a marked gap, such as [Author's story: the moment the reader needs here], and the author is asked for it. Candidate moments can be named from what the author has already shared; the story itself is never written for them, not even as a sample to react to.

After a draft lands, the agent reads it and fixes rule slips with small rewrites, then checks the chapter for repeated points, openings and phrasing across beats. A beat whose commitment changed is redrafted from the new commitment rather than patched by hand.

### Handoffs

An editorial handoff states the scope and version actually read, the changes proposed, checks performed, unresolved questions and the next useful step. Earlier pass results do not show that text changed since was checked. Completion comes from evidence of the pass, never a status label, elapsed time, a writing spinner or a lack of pending changes. Opening a document supplies context; it does not start a new editing job.

The attached brief records the author's direction, and its current accepted text arrives with these tools; the source revision list identifies changes since the last delivery. Relevant linked documents are read before writing; a stale snapshot or an unreviewed proposal is not an approved instruction. Conflicts between sources stay visible for the author to decide. A document shared by several books needs an explicit workspace context through get_item_context; the active browser tab never selects the book for the agent. No bundled guidance contains a user's private book content.
