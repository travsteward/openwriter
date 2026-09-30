import { Extension, mergeAttributes } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TextStyle } from '@tiptap/extension-text-style';
import Typography from '@tiptap/extension-typography';
import Underline from '@tiptap/extension-underline';
import UniqueID from '@tiptap/extension-unique-id';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';

import { BlurredLoadingNode } from './BlurredLoadingNode';
import { ImageLoadingNode } from './ImageLoadingNode';
import { InsertionLoadingNode } from './InsertionLoadingNode';
import { PendingAttributes } from './PendingAttributes';
import { FootnoteReference, FootnoteSection, FootnoteDefinition } from './Footnotes';
import TweetImage from '../tweet-compose/TweetImage';
import { Bookmarks } from '../bookmarks/bookmark-plugin';

const lowlight = createLowlight(common);

// doc: links are internal navigation, not web links. Render them as
// <span> so the browser never treats them as anchors.
const PadLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      target: { default: null },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const { target, ...rest } = HTMLAttributes;
    if (rest.href?.startsWith('doc:')) {
      const { href, ...noHref } = rest;
      return ['span', { ...noHref, 'data-doc': href.slice(4), class: 'doc-link' }, 0];
    }
    return ['a', mergeAttributes(this.options.HTMLAttributes, rest), 0];
  },
});

export const padExtensions = [
  StarterKit.configure({
    codeBlock: false, // replaced by CodeBlockLowlight
    link: false, // replaced by PadLink
    underline: false, // added separately below (v3 StarterKit includes it by default)
  }),
  CodeBlockLowlight.configure({ lowlight }),
  PadLink.configure({
    openOnClick: false,
    // TipTap 3 validates URLs via isAllowedUri — by default it rejects custom
    // schemes like `doc:`, which broke the in-editor "Link to doc" feature.
    // Allow `doc:` explicitly so setLink({ href: 'doc:...' }) succeeds.
    isAllowedUri: (url, ctx) => {
      if (url.startsWith('doc:')) return true;
      return ctx.defaultValidate(url);
    },
    HTMLAttributes: {
      rel: 'noopener noreferrer nofollow',
    },
  }),
  TextStyle,
  Underline,
  Highlight,
  Subscript,
  Superscript,
  TaskList,
  TaskItem.configure({ nested: true }),
  Image,
  Typography,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  BlurredLoadingNode,
  ImageLoadingNode,
  InsertionLoadingNode,
  PendingAttributes,
  FootnoteReference,
  FootnoteSection,
  FootnoteDefinition,
  Bookmarks,
  Placeholder.configure({
    placeholder: 'Start writing...',
  }),
  UniqueID.configure({
    types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'tableRow', 'tableHeader', 'tableCell', 'taskList', 'taskItem', 'image', 'imageLoading', 'footnoteSection', 'footnoteDefinition'],
    attributeName: 'id',
    generateID: () => crypto.randomUUID().replace(/-/g, '').slice(0, 8),
  }),
];

/**
 * Scoped extension set for X Article compose view.
 * Only what X Articles actually support: bold, italic, headings (H1-H3),
 * links, images, lists, blockquotes. No code blocks, tables, tasks, etc.
 */
export const articleExtensions = [
  StarterKit.configure({
    codeBlock: false,
    horizontalRule: {},
    heading: { levels: [1, 2, 3] },
    link: false,
    underline: false,
  }),
  PadLink.configure({
    openOnClick: false,
    // TipTap 3 validates URLs via isAllowedUri — by default it rejects custom
    // schemes like `doc:`, which broke the in-editor "Link to doc" feature.
    // Allow `doc:` explicitly so setLink({ href: 'doc:...' }) succeeds.
    isAllowedUri: (url, ctx) => {
      if (url.startsWith('doc:')) return true;
      return ctx.defaultValidate(url);
    },
    HTMLAttributes: {
      rel: 'noopener noreferrer nofollow',
    },
  }),
  Image,
  BlurredLoadingNode,
  ImageLoadingNode,
  InsertionLoadingNode,
  PendingAttributes,
  Placeholder.configure({
    placeholder: 'Start writing...',
  }),
  UniqueID.configure({
    types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'image', 'imageLoading', 'horizontalRule'],
    attributeName: 'id',
    generateID: () => crypto.randomUUID().replace(/-/g, '').slice(0, 8),
  }),
];

/**
 * Tweet compose: Enter produces hardBreak (line break within a single paragraph),
 * matching X/Twitter behavior where Enter = newline, not new paragraph.
 * Double Enter: if cursor follows a hardBreak, remove it and split into a new
 * paragraph node instead — gives each "paragraph" its own node ID for agent editing.
 */
const TweetEnterHardBreak = Extension.create({
  name: 'tweetEnterHardBreak',
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const { $from } = state.selection;

        // Check if the node before cursor is a hardBreak
        const posBefore = $from.pos;
        const nodeBefore = posBefore > 0 ? state.doc.resolve(posBefore).nodeBefore : null;

        if (nodeBefore?.type.name === 'hardBreak') {
          // Double Enter: delete the preceding hardBreak and split into new paragraph
          const { tr } = state;
          tr.delete(posBefore - nodeBefore.nodeSize, posBefore);
          tr.split(tr.mapping.map(posBefore));
          this.editor.view.dispatch(tr);
          return true;
        }

        // Single Enter: insert hardBreak
        return this.editor.commands.setHardBreak();
      },
    };
  },
});

/** Base tweet extensions without Placeholder — lets TweetEditor configure per-tweet placeholder text */
export const tweetExtensionsBase = [
  StarterKit.configure({
    codeBlock: false,
    horizontalRule: false,
    heading: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    link: false,
    underline: false,
  }),
  PadLink.configure({
    openOnClick: false,
    // TipTap 3 validates URLs via isAllowedUri — by default it rejects custom
    // schemes like `doc:`, which broke the in-editor "Link to doc" feature.
    // Allow `doc:` explicitly so setLink({ href: 'doc:...' }) succeeds.
    isAllowedUri: (url, ctx) => {
      if (url.startsWith('doc:')) return true;
      return ctx.defaultValidate(url);
    },
    HTMLAttributes: {
      rel: 'noopener noreferrer nofollow',
    },
  }),
  TweetImage,
  BlurredLoadingNode,
  ImageLoadingNode,
  InsertionLoadingNode,
  PendingAttributes,
  TweetEnterHardBreak,
  UniqueID.configure({
    types: ['paragraph', 'image', 'imageLoading'],
    attributeName: 'id',
    generateID: () => crypto.randomUUID().replace(/-/g, '').slice(0, 8),
  }),
];

export const tweetExtensions = [
  ...tweetExtensionsBase,
  Placeholder.configure({
    placeholder: 'What is happening?!',
  }),
];
