# One canonical path per physical file

## Context

A filesystem path has many valid string representations for the same physical file:

- Forward vs backslash separators on Windows (`C:/Users/me` vs `C:\Users\me`)
- Drive-letter case (`C:` vs `c:`)
- Symlink-resolved vs raw paths
- 8.3 short names vs long names on legacy Windows shares
- Relative paths from different working directories
- Trailing slashes / double slashes

OpenWriter previously used raw user-supplied path strings as document
identity. Any code that compared paths by string equality — the external-
doc registry, the doc cache, the fs.watch subscription, the active-doc
filename — treated these representations as different identities.

Live evidence from the 2026-05-17 session: opening
`C:/Users/me/SKILL.md` after `C:\Users\me\SKILL.md` created two
openwriter documents tracking the same disk file. Each had its own
in-memory state, its own fs.watch subscription, its own pending overlay.
They could clobber each other through the side door — a stale autosave
from one identity overwriting the disk content the other had just
loaded.

A second, hidden bug under the same root cause: `isExternalDoc` checked
`filename.startsWith(getDataDir())` with raw strings. On Windows, a file
inside the data dir entered with forward slashes (`C:/Users/me/data-
dir/foo.md`) failed the prefix match against `getDataDir()`'s backslash
form, mis-classifying it as external.

## Current invariants

- `canonicalizePath(p: string): CanonPath` produces one canonical string
  per physical file on this host. Idempotent. Defined in
  `server/helpers.ts`.
- `realpathSync.native` is the primary mechanism — it asks the OS for
  the canonical path, which resolves symlinks, normalizes
  drive-letter case, separator direction, and 8.3 short names on
  Windows. Authoritative.
- Falls back to `path.resolve(p)` when the file doesn't exist (e.g., a
  not-yet-created file). Weaker — won't catch drive-letter case
  mismatches — but every openwriter identity boundary hits an existing
  file by the time it's used as identity.
- `CanonPath` is a branded string type
  (`string & { readonly __canon: unique symbol }`). The compiler
  refuses raw string assignment to slots typed `CanonPath` — every
  identity slot is forced through the canonicalize function.
- Identity slots typed `CanonPath`:
  - `externalDocs: Set<CanonPath>` in state.ts
  - `docCache: Map<CanonPath, CachedDoc>` in state.ts
  - `state.filePath: CanonPath | ''` in state.ts (empty before first save)
  - `activeWatcherPath: CanonPath | ''` in state.ts
- Entry points that accept user-supplied or browser-sent paths
  canonicalize at the boundary:
  - `registerExternalDoc(p)` — canonicalizes before adding to the Set
  - `loadExternalDocs()` — canonicalizes each entry on load + persists
    the deduplicated set back to disk (one-time migration for legacy
    duplicates)
  - `unregisterExternalDoc(p)` — canonicalizes before deleting
  - `setActiveDocument(...)` — canonicalizes the filePath param into
    `state.filePath`
  - `save()` — canonicalizes the temp/title-derived path on first save
  - `load()` — canonicalizes the disk file path before assigning to
    `state.filePath`
  - `openFile(p)` — canonicalizes the input once at entry, uses the
    canonical form for all subsequent operations within the function
  - `cacheActiveDocument` / `getCachedDocument` / `invalidateDocCache` /
    `updateCacheEntry` — canonicalize before Map key operations
  - WS `doc-update` message handler — canonicalizes `msg.filename`
    before comparing against `getActiveFilename()`. Without this, a
    browser tab that cached a pre-canonicalization path spelling sends
    doc-updates that look like they're for a different doc, triggering
    `saveDocToFile()` to write to the old non-canonical path —
    re-creating duplicate documents.
- `canonicalizeIdentifier(id)` is the wrapper for boundaries where the
  input might be a basename (internal doc) or an absolute path
  (external doc). Basenames pass through untouched; absolute paths
  route through `canonicalizePath`. Used at the WS boundary where
  browser-sent filenames are mixed-shape.
- `isExternalDoc(filename)` canonicalizes both sides of the comparison
  (the filename and `getDataDir()`) before `startsWith`. Same physical
  file via any spelling now classifies consistently.
- Paths used only for fs operations (read, write, exists checks) are
  NOT canonicalized — every Node fs API accepts any valid
  representation and resolves internally. Canonicalization is for
  identity (comparison, storage as map key), not for the OS call
  itself.

## Decision log (append-only)

### 2026-05-17 — initial implementation
- Bug: opening the same external file via forward-slash vs backslash
  paths created two openwriter documents with parallel state. Caused
  during a live integration test of an unrelated fix.
- Hidden second bug: `isExternalDoc` mis-classified internal files
  entered with forward slashes as external on Windows.
- Architectural fix: one canonical representation per physical file
  via `realpathSync.native`, applied at every identity boundary, with
  compile-time enforcement via the `CanonPath` branded string type.
- Rejected alternative: switch external-doc identity to `docId` and
  store path as an attribute. Cleaner endgame but blast radius too
  wide for this fix. Filed for future consideration if path
  canonicalization proves insufficient in practice.
- Files changed:
  - `server/helpers.ts` — added `CanonPath` branded type,
    `canonicalizePath`, `canonicalizeIdentifier`. Fixed `isExternalDoc`
    to canonicalize both sides of the comparison.
  - `server/state.ts` — typed `externalDocs` as `Set<CanonPath>`,
    `docCache` as `Map<CanonPath, CachedDoc>`, `state.filePath` as
    `CanonPath | ''`, `activeWatcherPath` as `CanonPath | ''`. Wired
    `canonicalizePath` into `registerExternalDoc`, `loadExternalDocs`
    (with migration), `unregisterExternalDoc`, `setActiveDocument`,
    `cacheActiveDocument`, `getCachedDocument`, `invalidateDocCache`,
    `updateCacheEntry`, `save`, `load`.
  - `server/documents.ts` — canonicalize `fullPath` at the entry to
    `openFile`, use the canonical form throughout.
  - `server/ws.ts` — canonicalize `msg.filename` via
    `canonicalizeIdentifier` before comparing against
    `getActiveFilename()`.
  - `scripts/test-path-canonicalization.mjs` — 18-assertion
    regression test covering separator variants, idempotence,
    non-existent file fallback, empty input, `isExternalDoc`
    classification across separator forms, deduplication via
    `registerExternalDoc`, and `canonicalizeIdentifier` mixed-shape
    handling.
- Verification: full unit suite green (24 files, 549 assertions).
  Live integration test pending.

### 2026-10-06 — unrelated addition in helpers.ts
`pinProfile` / `isProfilePinned` were added next to the profile state in `server/helpers.ts` for the
`--profile` flag (`adr/pinned-profile.md`). Path canonicalization is unchanged.
