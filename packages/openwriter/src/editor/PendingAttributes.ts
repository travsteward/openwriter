/**
 * TipTap extension: registers pendingStatus + pendingOriginalContent as global
 * attributes on all block node types. Without this, TipTap silently drops
 * unknown attrs during insertContentAt(), and decorations never appear.
 */

import { Extension } from '@tiptap/core';

const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'table',
  'taskList',
  'taskItem',
  'image',
];

export const PendingAttributes = Extension.create({
  name: 'pendingAttributes',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          pendingStatus: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-pending-status') || null,
            renderHTML: (attributes: Record<string, any>) => {
              if (!attributes.pendingStatus) return {};
              return { 'data-pending-status': attributes.pendingStatus };
            },
          },
          pendingOriginalContent: {
            default: null,
            rendered: false, // Internal only — never serialized to HTML
          },
          pendingFeedback: {
            default: null,
            rendered: false, // Pending review note, never document HTML
          },
          pendingSelectionFrom: {
            default: null,
            rendered: false,
          },
          pendingSelectionTo: {
            default: null,
            rendered: false,
          },
          pendingOriginalFrom: {
            default: null,
            rendered: false,
          },
          pendingOriginalTo: {
            default: null,
            rendered: false,
          },
          pendingGroupId: {
            default: null,
            rendered: false, // Internal only — links nodes in a range rewrite group
          },
          /**
           * Flag: this pending entry was promoted to an insert at end of doc
           * because its original anchor (the rewrite target, or the
           * afterNodeId for an insert) disappeared between proposal and
           * reload. Creative content is preserved but visually distinct so
           * the user knows it's not in its intended location.
           * adr: adr/pending-overlay-model.md
           */
          pendingOrphan: {
            default: null,
            rendered: false, // Internal only — drives plugin's class decision
          },
          /**
           * Flag: this rewrite's originalBaseline (canonical content at the
           * time the rewrite was proposed) differs from canonical's current
           * content. The rewrite still applies, but the user should know
           * the source-of-truth shifted under it.
           * adr: adr/pending-overlay-model.md
           */
          pendingStaleBaseline: {
            default: null,
            rendered: false,
          },
        },
      },
    ];
  },
});
