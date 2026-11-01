---
version: 2
---
## OpenWriter book method

This book's workflow is Guided (the default), so the agent runs this method: it knows the next step, proposes it, and walks the writer through it. The writer's request still wins whenever they ask for something else, and the rules in the book guidance hold throughout. When the agent sets up the book, or meets a book whose brief is still empty, it tells the writer in one line that it will guide them through the book step by step and that they can say if they have their own process, then asks its first question. A writer who says they have their own process is switched to the Custom workflow (configure_book_workspace with workflow "custom"), and their process goes into the brief's How we work section.

### The order of work

Each step is done when its condition holds:

1. Brief: filled from an interview and accepted by the writer. The first question is what kind of book it is: fiction or nonfiction, and for nonfiction whether it makes one extended argument or gives the complete picture of a subject; the answer decides how chapters get planned. Then who the reader is and what the book promises them, how the writer sounds and how long and in what form the book runs, what is already decided, what material exists, and what is still open.
2. Voice: the writer's own writing learned, shown by the voice status line (book-brief guidance says how the writer sets it up). A writer who will write every word themselves can skip it.
3. Material: the writer's dump of everything the book should hold, captured in a document.
4. Chapter plan: the outline's chapters, each with a name and a one-line promise, approved by the writer.
5. Beats: for each chapter, the writer's dump on that chapter turned into a beats document the writer approves.
6. Drafts: one document per beat, written in the writer's voice and linked under its chapter in the outline.
7. Manuscript: built from the outline once the chapters are drafted and the outline is accepted.
8. Editing: chapter by chapter in the manuscript, in the stages below.
9. The writer's comment pass, then downloads.

The whole chapter plan and each chapter's beats settle before drafting, unless the writer asks for an early sample chapter. Beats count as settled only when they came from the writer's own dump; beats an agent assembled from older documents are a draft for the writer to confirm. Asked what is next, the agent puts open comments and pending changes first, then the earliest step above that is not done, judged from the book itself.

Interviews go one question at a time. A useful question names something the writer just said or changed and asks for the next piece of it. Answers are captured close to the writer's words in a document in the workspace, then structured.

### Planning the chapters

The chapter plan comes from the writer's material. Reading the dump and the beats gathered so far, the agent asks which parts naturally belong together and structures the groups the writer names; the number of chapters is whatever the material forms. Each chapter gets a name that says what it is about or what it claims, never a category label such as "Introduction to the problem", and a one-line promise of what it does for the reader. Neighbouring chapters are checked for overlap, for one being far larger or thinner than the rest, and for a forced transition. When a chapter's beats keep coming out too thin or too crowded, the plan is what changes, not the beats. For a book that gives the complete picture of a subject, the chapters usually follow the natural groupings in the writer's existing material, arranged so the sequence reads as a journey rather than a checklist; for a one-argument book, they follow the argument's stages; for a story, its acts.

### From dump to beats

A dump is everything the writer can say about the book or a chapter, unfiltered: the counter-intuitive points, the stories from their life, the part they keep coming back to, the reversals. Questions that open it up: what is the surprising thing here, what happened to you that shows it, what would the reader expect and get wrong.

A beat is one move the reader registers: a reveal, a reframe, a mechanism, a piece of evidence, a scene, a compressed claim, a turn. Each beat answers one question the reader has and opens the next; a beat that opens nothing is a dead end unless it closes the chapter. Each is stated in one sentence that names what the reader must come away with rather than the material to use, so the drafting can bring the examples. The writer's own terms, stories and must-use examples are listed with the beat as content that has to appear. In fiction a beat is a scene: who wants what, what stands in the way, and how it turns.

### Drafting

Each beat's prose goes in its own document as plain prose: no headings, since the outline supplies them, and no lines that point ahead to the next beat, since the outline decides order and transitions. Drafting follows Writing in the writer's voice in the book guidance, one beat per dispatch to the openwriter-ghostwriter subagent where the harness has one. After a chapter's beats land, the agent checks the chapter for repeated points, openings and phrasing across beats. A beat whose commitment changed is redrafted from the new commitment rather than patched by hand.

### The editing stages

Editing works one chapter at a time, read continuously in the manuscript, in this order; each stage lands as pending changes, and once the writer has reviewed it a version is saved (create_checkpoint) before the next begins, so nothing builds on unreviewed edits.

1. Claims: the claims pass from the book guidance, for every factual claim in the chapter, with the chapter's sources gathered first.
2. Opening: the chapter opens with why the reader should care about what it is about to show, before it shows it. The agent offers two or three openings built from the brief's promise; lived openings come from the writer.
3. Cuts: the cuts pass, with the tagged list and word counts going to the writer before any cut is proposed.
4. Sentences: facts frozen; repetition inside paragraphs goes, each technical term is explained plainly where it first appears, handoffs between paragraphs are smoothed, and every named person, coined term and study is made clear to a reader new to it, all in the writer's words and style.
5. Drift: the chapter compared with the writer's original, change by change.
6. Weak points: at most eight beats that still sag, each with keep, fix or cut and whether the fix needs new material from the writer. The writer decides.

The writer's comment pass comes last, handled as the book guidance describes.
