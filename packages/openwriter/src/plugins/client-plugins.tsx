/**
 * Client plugin API. A plugin with a `clientModule` (server/plugin-types.ts) has its module
 * imported at page load; the module's default export receives this API and registers UI:
 *
 *   export default function activate(api) {
 *     api.registerRailTab({ id: 'notes', label: 'Notes', icon: '<svg …/>', mount(el, ctx) { … } });
 *   }
 *
 * A plugin mounts its own UI into the element it is given (any library, its own React root), and
 * returns `{ update?(ctx), unmount() }`. It never renders inside the app's React tree, so it
 * cannot break it. A plugin that presents the app its own way reads what the app shows
 * (`getApp`, `onAppChange`), drives it through `app`, and decorates the editor with the app's
 * own ProseMirror classes (`pm`). adr: adr/open-source-boundary.md
 */
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { Plugin, PluginKey, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { DOMSerializer } from '@tiptap/pm/model';
import { showToast } from '../utils/toast';
import { TAB_ID, type SyncStatus } from '../ws/client';
import { canonicalTabId, requestSettingsSection } from '../right-rail/types';

/** A plugin's mounted view. `update` receives fresh context; `unmount` tears it down. */
export interface MountedView<C> {
  update?(ctx: C): void;
  unmount(): void;
}

export interface RailTabContext {
  /** The open document's docId, or null. */
  docId: string | null;
  /** The open document's filename. */
  filename: string;
  /** Open a rail tab: a built-in id ('review', 'activity', …) or a plugin tab's own id. */
  openTab(id: string): void;
  switchDocument(filename: string): void;
}

export interface PluginRailTab {
  id: string;
  label: string;
  /** 16x16 inline SVG markup for the tab strip (and the titlebar toggle). */
  icon: string;
  /** Lead the tab strip instead of following the built-in tabs. */
  first?: boolean;
  /** A titlebar button that opens this tab, or closes the rail while it is showing. */
  titlebarToggle?: boolean;
  /** While this tab is showing, new pending changes do not switch the rail to Review. */
  holdOpenOnPending?: boolean;
  /** The tab the rail shows on its first run in this browser, instead of Activity. */
  openOnFirstRun?: boolean;
  mount(el: HTMLElement, ctx: RailTabContext): MountedView<RailTabContext>;
}

/**
 * Lines of the app's own copy a plugin may reword for the way it presents the app (its own
 * agent, its own place to publish from), or hide with null. Unset, each shows its default.
 */
export type UiTextSlot =
  /** Review with nothing pending: the note under "All caught up". */
  | 'review.empty'
  /** Activity with no entries: the note under "No activity yet". */
  | 'activity.empty'
  /** The one-time tip on the Activity icon when the first entry arrives. */
  | 'activity.hint'
  /** A newsletter's footer, with a publish connection: how to email it to readers. */
  | 'newsletter.publishHint'
  /** A plugin missing a required setting; `{name}` becomes the plugin's name. */
  | 'plugins.setupHint'
  /** Settings > Connections with no publish account: how to get started. */
  | 'connections.setupHint'
  /** The Workspace type dialog, Book: who receives the brief and book guidance. */
  | 'workspace.bookGuidance'
  /** Settings > Claude with no key and no OpenWriter sign-in: how to get free rewrites. */
  | 'claude.signInHint'
  /** Settings > Claude, first line: what runs on the Claude key or the balance. */
  | 'claude.intro'
  /** The profile menu's create, delete and restore controls. */
  | 'profiles.new'
  | 'profiles.delete'
  | 'profiles.restore';

export interface MenuPanelContext {
  editor: Editor;
  /** The open document's docId (8-hex), when it has one. */
  docId?: string;
  /** The selection captured at right-click. */
  selection: { from: number; to: number; nodes: any[]; nodeIds: string[]; text: string };
  /** Close the context menu. */
  close(): void;
}

export interface PluginMenuPanel {
  id: string;
  /** The context-menu item; choosing it replaces the menu's body with the panel. */
  label: string;
  /** Offer it only for a text selection, pending changes included. */
  needsSelection?: boolean;
  mount(el: HTMLElement, ctx: MenuPanelContext): MountedView<MenuPanelContext>;
}

/**
 * The app's own ProseMirror classes. A plugin builds its editor plugins and decorations from
 * these, never from its own copy of ProseMirror: the editor only recognises its own classes.
 */
export interface EditorKit {
  Plugin: typeof Plugin;
  PluginKey: typeof PluginKey;
  Decoration: typeof Decoration;
  DecorationSet: typeof DecorationSet;
  TextSelection: typeof TextSelection;
  NodeSelection: typeof NodeSelection;
  DOMSerializer: typeof DOMSerializer;
}

/** What the app is showing, as a plugin sees it. */
export interface AppSnapshot {
  /** The open document's editor (the first one, for a thread of several). */
  editor: Editor | null;
  docId: string | null;
  /** Empty until the server's first document arrives. */
  filename: string;
  title: string;
  metadata: Record<string, any>;
  /** The live connection to the server is open. */
  connected: boolean;
  /** This tab holds edits to the open document it has not handed to the server yet. */
  unsent: boolean;
  /** Documents with changes waiting for review, and how many each. */
  pendingDocs: { filenames: string[]; counts: Record<string, number> };
  /** GitHub sync, as the app's own status line shows it. */
  sync: SyncStatus;
}

/** The app's own navigation and review actions, for a plugin presenting them its own way. */
export interface AppActions {
  switchDocument(filename: string): void;
  createDocument(): void;
  /** Hand the open document's unsent edits to the server now. */
  flush(): void;
  setTitle(title: string): void;
  /**
   * Accept or reject one pending change (by its node id) or, without one, every change in
   * the open document; then tell the server when none is left, as the Review tab does.
   */
  resolvePending(action: 'accept' | 'reject', nodeId?: string): void;
  /** Mark one pending change as the one in focus (the line beside it), or none. */
  focusPending(nodeId: string | null): void;
  /** Show a pending rewrite's original text in its place, or (null) its proposed text again. */
  previewOriginal(nodeId: string | null): void;
  /**
   * Point the writer at changes they just asked for (a plugin's own writing action), as after a
   * right-click Enhance: once they arrive, the caret goes to them and their Accept · Reject bar
   * shows, accepting or rejecting them together, and Review opens unless a tab holds the rail.
   */
  showPending(nodeIds: string[]): void;
}

/** A labelled button in the rail's top bar, beside Sync: a way into a plugin's own screens. */
export interface PluginTopbarButton {
  id: string;
  /** The button's words, short ("Your site"). */
  label: string;
  /** The tooltip; defaults to the label. */
  title?: string;
  onClick(): void;
}

export interface SettingsPanelContext {
  /** Read the section's own settings again, after the panel changed something they show. */
  refresh(): void;
}

/**
 * A plugin's own controls inside a Settings section. In Claude they show above the balance, where
 * a program that keeps the writer's Claude key itself (`aiKey`) puts its key controls.
 */
export interface PluginSettingsPanel {
  id: string;
  section: 'claude';
  mount(el: HTMLElement, ctx: SettingsPanelContext): MountedView<SettingsPanelContext>;
}

export interface ClientPluginApi {
  registerRailTab(tab: PluginRailTab): void;
  registerMenuPanel(panel: PluginMenuPanel): void;
  registerTopbarButton(button: PluginTopbarButton): void;
  registerSettingsPanel(panel: PluginSettingsPanel): void;
  /** Reword (a string) or hide (null) lines of the app's own copy. */
  setUiText(text: Partial<Record<UiTextSlot, string | null>>): void;
  /** Open a rail tab: a built-in id or a plugin tab's own id. */
  openRailTab(id: string): void;
  showToast: typeof showToast;
  /** Called each time the live connection to the server drops. Returns an unsubscribe. */
  onConnectionLost(fn: () => void): () => void;
  pm: EditorKit;
  getApp(): AppSnapshot;
  /** Called after each change to the snapshot. Returns an unsubscribe. */
  onAppChange(fn: (app: AppSnapshot) => void): () => void;
  app: AppActions;
  /** This tab's id. Routes that act on the document a tab shows read it from the X-OW-Tab header. */
  tabId: string;
}

/** Fired on window by the WebSocket client when its socket closes (src/ws/client.ts). */
export const CONNECTION_LOST_EVENT = 'ow-connection-lost';

// ---- Registry ----

interface Registry {
  railTabs: PluginRailTab[];
  menuPanels: PluginMenuPanel[];
  topbarButtons: PluginTopbarButton[];
  settingsPanels: PluginSettingsPanel[];
  uiText: Partial<Record<UiTextSlot, string | null>>;
  /** Every plugin's client module has run (or failed): what plugins register at load is in. */
  settled: boolean;
}
let registry: Registry = { railTabs: [], menuPanels: [], topbarButtons: [], settingsPanels: [], uiText: {}, settled: false };
const listeners = new Set<() => void>();

function update(next: Partial<Registry>): void {
  registry = { ...registry, ...next };
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The registered plugin UI, re-rendering when a plugin registers more. */
export function useClientPlugins(): Registry {
  return useSyncExternalStore(subscribe, () => registry);
}

/**
 * A line of the app's copy: a plugin's wording, null when a plugin hid it, else the default.
 * Nothing (null) until the plugins' client modules have run, so the default never shows first
 * and then changes to a plugin's wording.
 */
export function useUiText<T extends ReactNode>(slot: UiTextSlot, fallback: T): T | string | null {
  const { uiText, settled } = useClientPlugins();
  const text = uiText[slot];
  if (text !== undefined) return text;
  return settled ? fallback : null;
}

/** Rail tab ids for plugin tabs are namespaced so they never collide with built-in ones. */
export function pluginTabId(id: string): `plugin:${string}` {
  return `plugin:${id}`;
}

const BUILT_IN_TABS = new Set(['review', 'versions', 'backlinks', 'exports', 'activity', 'settings']);

/** A built-in id stays as is (an old merged id becomes Settings); anything else names a plugin tab. */
export function resolveTabId(id: string): string {
  const builtIn = canonicalTabId(id);
  return BUILT_IN_TABS.has(builtIn) || id.startsWith('plugin:') ? builtIn : pluginTabId(id);
}

let railOpener: ((id: string) => void) | null = null;

/** Set by the right-rail provider so plugins can open tabs from outside React. */
export function setRailOpener(fn: ((id: string) => void) | null): void {
  railOpener = fn;
}

// ---- The app, as plugins see it ----

let appSnapshot: AppSnapshot = {
  editor: null, docId: null, filename: '', title: '', metadata: {},
  connected: false, unsent: false, pendingDocs: { filenames: [], counts: {} },
  sync: { state: 'unconfigured' },
};
const appListeners = new Set<(app: AppSnapshot) => void>();

/** Set by App as its state changes. */
export function publishApp(patch: Partial<AppSnapshot>): void {
  const keys = Object.keys(patch) as Array<keyof AppSnapshot>;
  if (keys.every((k) => appSnapshot[k] === patch[k])) return;
  appSnapshot = { ...appSnapshot, ...patch };
  for (const l of appListeners) {
    try { l(appSnapshot); } catch (err) { console.error('[plugins] app listener failed', err); }
  }
}

let appActions: AppActions | null = null;

/** Set by App once mounted; plugin calls before that do nothing. */
export function setAppActions(actions: AppActions | null): void {
  appActions = actions;
}

const api: ClientPluginApi = {
  registerRailTab(tab) {
    update({ railTabs: [...registry.railTabs.filter((t) => t.id !== tab.id), tab] });
  },
  registerMenuPanel(panel) {
    update({ menuPanels: [...registry.menuPanels.filter((p) => p.id !== panel.id), panel] });
  },
  registerTopbarButton(button) {
    update({ topbarButtons: [...registry.topbarButtons.filter((b) => b.id !== button.id), button] });
  },
  registerSettingsPanel(panel) {
    update({ settingsPanels: [...registry.settingsPanels.filter((p) => p.id !== panel.id), panel] });
  },
  setUiText(text) {
    update({ uiText: { ...registry.uiText, ...text } });
  },
  openRailTab(id) {
    requestSettingsSection(id);
    railOpener?.(resolveTabId(id));
  },
  showToast,
  onConnectionLost(fn) {
    window.addEventListener(CONNECTION_LOST_EVENT, fn);
    return () => window.removeEventListener(CONNECTION_LOST_EVENT, fn);
  },
  pm: { Plugin, PluginKey, Decoration, DecorationSet, TextSelection, NodeSelection, DOMSerializer },
  getApp: () => appSnapshot,
  onAppChange(fn) {
    appListeners.add(fn);
    return () => { appListeners.delete(fn); };
  },
  app: {
    switchDocument: (filename) => appActions?.switchDocument(filename),
    createDocument: () => appActions?.createDocument(),
    flush: () => appActions?.flush(),
    setTitle: (title) => appActions?.setTitle(title),
    resolvePending: (action, nodeId) => appActions?.resolvePending(action, nodeId),
    focusPending: (nodeId) => appActions?.focusPending(nodeId),
    previewOriginal: (nodeId) => appActions?.previewOriginal(nodeId),
    showPending: (nodeIds) => appActions?.showPending(nodeIds),
  },
  // A getter: ws/client imports this module, so TAB_ID may not exist yet when it loads.
  get tabId() { return TAB_ID; },
};

/**
 * Import every enabled plugin's client module. A module that fails is logged and skipped.
 * Settles the registry when done, however it ends.
 */
export async function loadClientPlugins(): Promise<void> {
  try {
    await importClientModules();
  } finally {
    update({ settled: true });
  }
}

async function importClientModules(): Promise<void> {
  let plugins: Array<{ name: string; clientModule?: string }> = [];
  try {
    const res = await fetch('/api/plugins');
    if (!res.ok) return;
    plugins = (await res.json()).plugins || [];
  } catch {
    return;
  }
  for (const p of plugins) {
    if (!p.clientModule) continue;
    try {
      const mod = await import(/* @vite-ignore */ p.clientModule);
      await mod.default?.(api);
    } catch (err) {
      console.error(`[plugins] ${p.name}: client module failed`, err);
    }
  }
}

// ---- Mounting ----

/** Hosts a plugin's view in a plain element: mounts once, passes new context, unmounts. */
export function PluginMount<C>({ mount, ctx, className }: {
  mount: (el: HTMLElement, ctx: C) => MountedView<C>;
  ctx: C;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const view = useRef<MountedView<C> | null>(null);
  const latest = useRef(ctx);
  latest.current = ctx;
  useEffect(() => {
    view.current = mount(ref.current!, latest.current);
    return () => { view.current?.unmount(); view.current = null; };
  }, [mount]);
  useEffect(() => { view.current?.update?.(ctx); }, [ctx]);
  return <div ref={ref} className={className} />;
}

/** A plugin's inline SVG icon as a React node. */
export function PluginIcon({ svg }: { svg: string }) {
  return <span className="plugin-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
