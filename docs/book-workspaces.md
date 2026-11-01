# Book workspaces

Create a workspace normally, then use its right-click menu or visible menu
button to open **Workspace type**. Choose **Book**. An existing outline and
its manuscript can be attached; unique candidates are offered automatically.
Multiple candidates require a choice. **General** removes book presentation
while retaining documents and attachments.

Outline and Manuscript shortcuts are pinned inside the workspace. Existing
folders, beats, research and revisions keep their positions. Files shows the
pins above the workspace tree. Timeline can be filtered to that workspace;
Board shows its pins when opened. There is no separate global Books block.

An empty book offers Create outline, then Build manuscript. Building opens the
existing saved-outline/source review and reuses its safeguards. Creating an
outline from selected Files documents fills an empty outline attachment. The
manuscript remains independent after assembly.

The attached Brief is an ordinary editable document, opened through the Brief
link. Create brief provides an empty scaffold; Settings can attach an existing
document. A brief can link to existing thesis, audience, voice, evidence and
decision documents and describe which are current, historical or unresolved.
Its links stay outside the outline's chapter-source list.

Agents can call configure_book_workspace with workspaceFile, workspaceType and
the optional outlineDocId, manuscriptDocId and briefDocId; createBrief and
createOutline add the same empty brief and outline the dialog creates. Normal
document tools still create, edit and review the writing. The book method
(interviews, the order of work, dump to beats, drafting, the editing stages)
arrives through versioned embedded guidance, like X format rules, with the
writer's voice status. Drafting reads the voice through get_voice, in the
openwriter-ghostwriter subagent where the harness has subagents.
The current accepted brief and directly linked source fingerprints arrive with
book document access. Changed sources refresh that snapshot. Pending brief
edits are identified and excluded until accepted. Shared-book membership calls
for an explicit get_item_context workspace; browser focus never selects it.

The book's private direction stays in its profile. Bundled guidance contains
generic editorial method only. No manual editorial stages or automatic writing
jobs are added by setting a workspace type or opening a document.

Validation: test-book-workspaces.ps1 covers preserved content/tree/review,
conversion back, attachment identity, ambiguity, source refresh, review authority
and workspace context for revisions. Browser checks use a disposable book.
