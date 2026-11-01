---
version: 3
---
## Book outline

This document uses the existing manuscript content type as a chapter plan. Chapter headings and ordered doc links determine assembly order. The visual outline editor edits those same headings and links; it is not a second outline format. Brief and research context belong in the attached brief, not in chapter-source lists unless their text is deliberately part of the book.

### How the outline compiles

A level-two heading is a chapter and renders as the book's top-level chapter heading; level three is a section within it, one level below, and so on. A heading with nothing linked under it still renders, so a part divider is just a heading. Each linked document's body is inserted in link order under its heading, and a linked document can be any size: a whole chapter, a scene, a section or a small piece. Headings inside a linked document are demoted to sit below the outline heading above them, so a chapter title kept inside a linked document appears nested under the outline's own chapter heading; documents linked under a chapter heading usually carry no title of their own. A {{toc}} line renders a contents list of the chapter headings. The book's title and author come from the outline's metadata.

A document is in the book only where it is linked. Choosing between two drafts of a passage is a matter of linking the chosen one; the other stays in the workspace, unlinked.

### Help with planning

When the writer wants help with structure, the agent works from the writer's own material: it asks which parts belong together, or proposes groupings of material the writer already gave and labels them as suggestions. The number of chapters is whatever the material forms. Structure follows the kind of book: the stages of an argument, the natural parts of a subject, the acts of a story, the periods of a life, the pieces of a collection. A one-line note of what each chapter does for the reader, and a check of neighbouring chapters for overlap, uneven size or a forced transition, help most writers; names and order are the writer's call. A writer who already has a draft can have the outline built from it instead.

### Building and changing

The Files selection action, Create book outline from selection, shows selected document names in order. The writer names chapters and adds the selected documents under them; creating an outline does not immediately compile or alter the sources. The outline UI supports chapter management, document selection and reordering.

Building the manuscript uses accepted source text and a review of the saved outline. Pending source edits are excluded. A changed outline or source invalidates a previously reviewed build. Existing manuscripts are reused and opened; another manuscript requires the existing explicit build-another flow. Empty or missing chapter sources remain visible instead of being silently filled.

After the first build, outline changes do not synchronize into the manuscript. Newly drafted chapters can be added through add_chapter_to_manuscript as pending changes. Editing already assembled prose happens in the Manuscript.
