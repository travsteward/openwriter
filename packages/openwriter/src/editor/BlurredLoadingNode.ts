/**
 * Shimmer loading effect for TipTap nodes during API calls.
 */

import { Extension, type CommandProps } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

interface LoadingNodeData {
  from: number;
  to: number;
  id: string;
  active: boolean;
  type: 'paragraph' | 'selection';
}

interface BlurredLoadingNodeStorage {
  loadingNodes: Record<string, LoadingNodeData>;
}

const blurredLoadingNodePluginKey = new PluginKey('blurredLoadingNode');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blurredLoadingNode: {
      applyLoadingEffect: (id: string, from: number, to: number, type?: 'paragraph' | 'selection') => ReturnType;
      removeLoadingEffect: (id: string) => ReturnType;
    };
  }
}

export const BlurredLoadingNode = Extension.create<BlurredLoadingNodeStorage>({
  name: 'blurredLoadingNode',

  addStorage() {
    return {
      loadingNodes: {},
    };
  },

  addCommands() {
    return {
      applyLoadingEffect: (id: string, from: number, to: number, type: 'paragraph' | 'selection' = 'paragraph') =>
        ({ editor }: CommandProps) => {
          const loadingNodes = { ...this.storage.loadingNodes };

          loadingNodes[id] = { from, to, id, active: true, type };
          this.storage.loadingNodes = loadingNodes;
          editor.view.dispatch(editor.view.state.tr);

          setTimeout(() => {
            if (editor.isFocused) {
              editor.commands.setTextSelection({ from, to: from });
            }
          }, 0);

          return true;
        },

      removeLoadingEffect: (id: string) =>
        ({ editor }: CommandProps) => {
          const loadingNodes = { ...this.storage.loadingNodes };

          if (loadingNodes[id]) {
            delete loadingNodes[id];
            this.storage.loadingNodes = loadingNodes;
            editor.view.dispatch(editor.view.state.tr);

            if (!editor.isFocused) {
              setTimeout(() => { editor.commands.focus(); }, 0);
            }
          }

          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blurredLoadingNodePluginKey,

        props: {
          decorations: (state) => {
            const loadingNodes = this.storage.loadingNodes;
            const decorations: Decoration[] = [];

            Object.entries(loadingNodes).forEach(([, nodeData]) => {
              const loadingNode = nodeData as LoadingNodeData;
              if (!loadingNode.active) return;

              const { from: rangeFrom, to: rangeTo, type } = loadingNode;

              if (type === 'selection') {
                decorations.push(Decoration.inline(rangeFrom, rangeTo, {
                  class: 'node-blur-selection',
                }));
              } else {
                state.doc.nodesBetween(rangeFrom, rangeTo, (node, pos) => {
                  if (['paragraph', 'heading', 'blockquote', 'listItem', 'codeBlock'].includes(node.type.name)) {
                    decorations.push(Decoration.node(pos, pos + node.nodeSize, {
                      class: 'node-blur-effect',
                    }));
                    return false;
                  }
                  return true;
                });
              }
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
