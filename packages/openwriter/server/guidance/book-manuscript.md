---
version: 4
---
## Book manuscript

This is the independent book text built from its outline. It has variantType manuscript and masterDocId pointing to the outline. Edits to source documents or the outline do not update this text. Once it exists, editing the assembled book, the writer's review and book downloads happen here; the editing passes and the comment pass are in the book guidance. Downloads use accepted text; pending changes are proposals, not published prose.

A pass reads the manuscript continuously, the way a reader meets it, since seams between chapters only show in the assembled text. Once the writer has reviewed a pass, a saved version (create_checkpoint) gives a restore point before the next.

### Building and adding chapters

The existing outline and manuscript remain connected. add_chapter_to_manuscript brings a newly available outline chapter into this manuscript as one pending change. Rebuilding the whole book is not the way to apply an ordinary edit or append one chapter. The original-version and revision tools preserve recoverable versions.
