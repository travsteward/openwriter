/**
 * The site paywall: a horizontalRule with `paywall: true`, drawn as a labelled
 * divider (App.css). On disk it is the line `<!-- paywall -->`.
 * adr: adr/paywall-marker.md
 */

import { Extension, type Editor } from '@tiptap/core';

export const PaywallAttribute = Extension.create({
  name: 'paywallAttribute',

  addGlobalAttributes() {
    return [
      {
        types: ['horizontalRule'],
        attributes: {
          paywall: {
            default: null,
            parseHTML: (element: HTMLElement) => (element.hasAttribute('data-paywall') ? true : null),
            renderHTML: (attributes: Record<string, any>) => (attributes.paywall ? { 'data-paywall': 'true' } : {}),
          },
        },
      },
    ];
  },
});

/** Put the doc's one paywall at the cursor, moving it there if the doc already has one. */
export function insertPaywall(editor: Editor): void {
  const existing: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'horizontalRule' && node.attrs.paywall) existing.push(pos);
  });
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      // Last first, so earlier positions stay valid.
      for (const pos of existing.reverse()) tr.delete(pos, pos + 1);
      return true;
    })
    .insertContent({ type: 'horizontalRule', attrs: { paywall: true } })
    .run();
}
