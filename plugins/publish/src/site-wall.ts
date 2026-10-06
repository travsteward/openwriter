/**
 * Turn a document's HTML (with its `<!-- paywall -->` marker still in) into what
 * the site API takes: the HTML without the marker, plus wall_at = the number of
 * top-level blocks above it. Pure, so scripts/test-site-wall.mjs tests it directly.
 * adr: adr/paywall-marker.md
 */

const MARKER = /<!--\s*paywall\s*-->\n?/gi;

// The backend's counter (openwriter-publish src/modules/sites/access.ts htmlBeforeWall):
// a top-level block ends when a closing tag returns to depth 0, or is a void element.
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g;
const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'source', 'track', 'wbr']);

export type WallPlacement = { ok: true; html: string; wall_at: number | null } | { ok: false; error: string };

export function placeWall(html: string): WallPlacement {
  const markers = [...html.matchAll(MARKER)];
  if (markers.length > 1) {
    return { ok: false, error: `The document has ${markers.length} paywall markers; a post takes exactly one. Remove the extras.` };
  }
  if (markers.length === 0) return { ok: true, html, wall_at: null };

  const at = markers[0].index!;
  const above = html.slice(0, at);
  let depth = 0;
  let blocks = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(above); m; m = TAG.exec(above)) {
    const [, closing, name, selfClosing] = m;
    if (!name) continue; // comment
    if (closing) depth--;
    else if (!selfClosing && !VOID.has(name.toLowerCase())) depth++;
    if (depth === 0) blocks++;
  }
  if (depth !== 0) {
    return { ok: false, error: 'The paywall sits inside a list, quote or table. Move it between top-level blocks.' };
  }
  return { ok: true, html: html.slice(0, at) + html.slice(at + markers[0][0].length), wall_at: blocks };
}
