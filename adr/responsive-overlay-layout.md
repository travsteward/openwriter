# Responsive Overlay Layout (docked ⇄ overlay panels)

## Context

Below a certain window width, the old layout squished the doc: sidebar and
right rail are `flex-shrink: 0`, so the editor column (`flex: 1`) absorbed
100% of the loss, down to unreadable widths. The fix: when the doc would drop
below readable width, panels stop pushing and float over the doc as drawers
(scrim + Esc/click-out to close). `App.tsx` computes the mode from one
ResizeObserver on `.app`; `.app--overlay` switches panel CSS to
`position: absolute`.

## Current invariants

- **Mode is a pure function of *intent*, never of itself.** `overlay` is
  computed from `containerWidth − (sidebarOpen ? sidebarWidth : 0) −
  (railOpen ? railWidth : 0) < 600px` (+48px hysteresis on the way out),
  where `sidebarOpen` / `railOpen` are the *persisted user intent*. Flipping
  modes must never write intent — entering overlay closes only the transient
  drawer state (`sidebarDrawer`, rail `drawerOpen`), so widening the window
  restores exactly what was docked. If a mode flip ever mutates intent, the
  computation feeds back on itself and the boundary flaps (close panel →
  more room → exit overlay → reopen panel → less room → enter overlay …).
- **Two visibility vocabularies.** Intent (`open`) answers "what does the
  user want docked"; `visible` (= `overlay ? drawerOpen : open`) answers "is
  the panel showing now". UI chrome (titlebar buttons, rail icon strip,
  keepalive mount) must gate on `visible`, not `open`.
- **In overlay, every open/close call targets the drawer.** The rail context
  routes `openTab`/`closeRail`/`toggleRail` through `overlayRef` so existing
  callers (auto-open Review, activity pulse, titlebar) need no knowledge of
  the mode. Same for the sidebar via App's `overlay ? setSidebarDrawer : setSidebarOpen`.
- **Drawer state is transient.** Never persisted, reset on every mode flip
  (entering overlay starts closed so a resize never covers the doc).
- **Resize handles are docked-only.** Overlay drawers reuse the saved width.
- **Sidebar width lives in App** (controlled prop) so the overlay formula
  reacts to drags live; Sidebar persists to `ow-sidebar-width` on drag-end.
- **Focus mode composes by closing drawers outright** (not snapshotting
  them) and skips the rail restore-on-exit while in overlay — exiting focus
  on a narrow window lands on a clean doc, not a drawer over it.
- **Board mode is exempt** (`overlay` forced false): its sidebar renders
  inside `app-main`, so the formula's panel widths don't apply.
- **Floor:** `.app { min-width: 360px }` + `body { overflow-x: auto }` — below
  360px the viewport scrolls; the doc never narrows further.

## Decision log

- **2026-09-08** — Extracted the existing Focus mode transition into
  `useFocusMode` before extending its entry path. Sidebar/toolbar snapshot,
  drawer closure, and the rail's existing transition behavior are unchanged.

- **2026-06-09** — Initial implementation. Chose a *computed* threshold
  (doc-floor 600px against live panel widths) over a fixed px breakpoint so
  user-resized panels are respected; chose one shared flip for both panels
  over staggered breakpoints (one jump, one state). RightRailProvider hoisted
  to `main.tsx` so App can read rail intent/width and push the mode down.

### 2026-09-07 — Manuscript editing drafts

Editing drafts reuse the controlled sidebar for a compact chapter outline. They use the ordinary document layout even when the library preference is Board; library and drawer preferences remain unchanged.

### 2026-09-07 — UX audit closure

Hidden sidebar and rail controls are inert; closing a focused panel returns focus to the opener. Layout widths and overlay thresholds are unchanged.

### 2026-09-08 — Revisions use ordinary layout and Focus mode

Removed editing-draft sidebar overrides and their Board-mode exception. Revision
placement uses the existing variant tree. A focus=1 URL request is consumed once
and enters the existing Focus transition; panel intent/restoration and the
mounted editor are preserved. Compact sidebar styling is unchanged.
