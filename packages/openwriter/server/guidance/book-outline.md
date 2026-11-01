---
version: 2
---
## Book outline

This document uses the existing manuscript content type as a chapter plan. Chapter headings and ordered doc links determine assembly order. The visual outline editor edits those same headings and links; it is not a second outline format. Brief and research context belong in the attached brief, not in chapter-source lists unless their text is deliberately part of the book.

### Planning the chapters

The chapter plan comes from the author's material. Reading the author's dump and the beats gathered so far, the agent asks which parts naturally belong together and structures the groups the author names; the number of chapters is whatever the material forms. Each chapter gets a name that says what it is about or what it claims, never a category label such as "Introduction to the problem", and a one-line promise of what it does for the reader. Neighbouring chapters are checked for overlap, for one being far larger or thinner than the rest, and for a forced transition. The author approves the plan before per-chapter beat work begins. When a chapter's beats keep coming out too thin or too crowded, the plan is what changes, not the beats.

For a book that gives the complete picture of a subject, the chapters usually follow the natural groupings in the author's existing material, arranged so the sequence reads as a journey rather than a checklist. For a one-argument book, they follow the argument's stages.

### How the outline compiles

A level-two heading is a chapter and renders as the book's top-level chapter heading; level three is a section within it, one level below, and so on. A heading with nothing linked under it still renders, so a part divider is just a heading. Each linked document's body is inserted in link order under its heading; headings inside a linked document are demoted to sit below the outline heading above them, so beat documents carry no headings of their own. A {{toc}} line renders a contents list of the chapter headings. The book's title and author come from the outline's metadata.

A document is in the book only where it is linked. Picking between two drafts of a beat is a matter of linking the chosen one; the other stays in the workspace, unlinked.

### Building and changing

The Files selection action, Create book outline from selection, shows selected document names in order. The writer names chapters and adds the selected documents under them; creating an outline does not immediately compile or alter the sources. The outline UI supports chapter management, document selection and reordering.

Building the manuscript uses accepted source text and a review of the saved outline. Pending source edits are excluded. A changed outline or source invalidates a previously reviewed build. Existing manuscripts are reused and opened; another manuscript requires the existing explicit build-another flow. Empty or missing chapter sources remain visible instead of being silently filled.

After the first build, outline changes do not synchronize into the manuscript. Newly drafted chapters can be added through add_chapter_to_manuscript as pending changes. Editing already assembled prose happens in the Manuscript.
