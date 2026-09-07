export type Typeface = 'charter' | 'source-serif' | 'plex-mono' | 'crimson' | 'inter' | 'baskerville' | 'grotesk' | 'literata' | 'dm-sans';
export type ThemeMode = 'light' | 'dark';
export type SidebarMode = 'default' | 'timeline' | 'board' | 'shelf' | 'files';
export type SidebarStyle = 'cards' | 'compact';
export type SidebarDensity = 'full' | 'compact' | 'minimal';
export type CanvasStyle = 'seamless' | 'outline' | 'page' | 'paper';
export type SpacingPreset = 'default' | 'butterick' | 'web' | 'blog';

export interface TypefaceInfo {
  id: Typeface;
  label: string;
  description: string;
}

export const TYPEFACES: TypefaceInfo[] = [
  { id: 'charter', label: 'Charter', description: 'Charter serif' },
  { id: 'source-serif', label: 'Source Serif', description: 'Source Serif 4' },
  { id: 'plex-mono', label: 'Plex Mono', description: 'IBM Plex Mono' },
  { id: 'crimson', label: 'Crimson', description: 'Crimson Pro' },
  { id: 'inter', label: 'Inter', description: 'Inter sans-serif' },
  { id: 'baskerville', label: 'Baskerville', description: 'Libre Baskerville' },
  { id: 'grotesk', label: 'Grotesk', description: 'Space Grotesk' },
  { id: 'literata', label: 'Literata', description: 'Literata serif' },
  { id: 'dm-sans', label: 'DM Sans', description: 'DM Sans + Serif' },
];

export const SIDEBAR_MODES: { id: SidebarMode; label: string; icon: string }[] = [
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'default', label: 'Tree', icon: 'tree' },
  { id: 'timeline', label: 'Timeline', icon: 'timeline' },
  { id: 'board', label: 'Board', icon: 'board' },
];

export const SIDEBAR_STYLES: { id: SidebarStyle; label: string }[] = [
  { id: 'cards', label: 'Original' },
  { id: 'compact', label: 'Compact' },
];

export const CANVAS_STYLES: { id: CanvasStyle; label: string }[] = [
  { id: 'seamless', label: 'Seamless' },
  { id: 'outline', label: 'Outline' },
  { id: 'page', label: 'Page' },
  { id: 'paper', label: 'Paper' },
];

export const SPACING_PRESETS: { id: SpacingPreset; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'web', label: 'Web' },
  { id: 'blog', label: 'Blog' },
  { id: 'butterick', label: 'Butterick' },
];

const SIDEBAR_DENSITIES: SidebarDensity[] = ['full', 'compact', 'minimal'];

const KEYS = {
  typeface: 'ow-typeface',
  mode: 'ow-theme-mode',
  sidebarMode: 'ow-sidebar-mode',
  sidebarStyle: 'ow-sidebar-style',
  sidebarDensity: 'ow-sidebar-density',
  spacing: 'ow-spacing',
  canvas: 'ow-canvas',
} as const;

// Migration: old ow-theme → ow-typeface (color axis removed)
const TYPEFACE_MIGRATION: Record<string, Typeface> = {
  ink: 'charter',
  novel: 'source-serif',
  mono: 'plex-mono',
  editorial: 'crimson',
  studio: 'inter',
  prose: 'baskerville',
};

function migrateIfNeeded(): void {
  // Migrate ow-theme → ow-typeface
  const oldTheme = localStorage.getItem('ow-theme');
  if (oldTheme && !localStorage.getItem(KEYS.typeface)) {
    const tf = TYPEFACE_MIGRATION[oldTheme];
    if (tf) localStorage.setItem(KEYS.typeface, tf);
    localStorage.removeItem('ow-theme');
  }

  // Clean up stale color key
  localStorage.removeItem('ow-color');

  // Migrate ow-typography → ow-spacing
  const oldTypography = localStorage.getItem('ow-typography');
  if (oldTypography && !localStorage.getItem(KEYS.spacing)) {
    localStorage.setItem(KEYS.spacing, oldTypography);
    localStorage.removeItem('ow-typography');
  }
}

export function getTypeface(): Typeface {
  const stored = localStorage.getItem(KEYS.typeface);
  if (stored && TYPEFACES.some(t => t.id === stored)) return stored as Typeface;
  return 'charter';
}

export function getMode(): ThemeMode {
  const stored = localStorage.getItem(KEYS.mode);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getSidebarMode(): SidebarMode {
  const stored = localStorage.getItem(KEYS.sidebarMode);
  if (stored && SIDEBAR_MODES.some(m => m.id === stored)) return stored as SidebarMode;
  return 'files';
}

export function getSidebarStyle(): SidebarStyle {
  const stored = localStorage.getItem(KEYS.sidebarStyle);
  if (stored && SIDEBAR_STYLES.some(style => style.id === stored)) return stored as SidebarStyle;
  return 'cards';
}

export function getSidebarDensity(): SidebarDensity {
  const stored = localStorage.getItem(KEYS.sidebarDensity);
  if (stored && SIDEBAR_DENSITIES.includes(stored as SidebarDensity)) return stored as SidebarDensity;
  return 'full';
}

export function setSidebarDensity(density: SidebarDensity): void {
  localStorage.setItem(KEYS.sidebarDensity, density);
  document.documentElement.setAttribute('data-sidebar-density', density);
}

export function getSpacing(): SpacingPreset {
  const stored = localStorage.getItem(KEYS.spacing);
  if (stored && SPACING_PRESETS.some(t => t.id === stored)) return stored as SpacingPreset;
  return 'default';
}

export function getCanvasStyle(): CanvasStyle {
  const stored = localStorage.getItem(KEYS.canvas);
  if (stored && CANVAS_STYLES.some(c => c.id === stored)) return stored as CanvasStyle;
  return 'seamless';
}

export function applyAppearance(
  typeface: Typeface,
  mode: ThemeMode,
  sidebarMode: SidebarMode,
  sidebarStyle: SidebarStyle,
  spacing: SpacingPreset = 'default',
  canvas: CanvasStyle = 'seamless',
): void {
  const el = document.documentElement;
  el.setAttribute('data-typeface', typeface);
  el.setAttribute('data-mode', mode);
  el.setAttribute('data-sidebar-mode', sidebarMode);
  el.setAttribute('data-sidebar-style', sidebarStyle);
  if (spacing === 'default') {
    el.removeAttribute('data-spacing');
  } else {
    el.setAttribute('data-spacing', spacing);
  }
  if (canvas === 'seamless') {
    el.removeAttribute('data-canvas');
  } else {
    el.setAttribute('data-canvas', canvas);
  }
  // Clean up old data-color attribute
  el.removeAttribute('data-color');
  localStorage.setItem(KEYS.typeface, typeface);
  localStorage.setItem(KEYS.mode, mode);
  localStorage.setItem(KEYS.sidebarMode, sidebarMode);
  localStorage.setItem(KEYS.sidebarStyle, sidebarStyle);
  localStorage.setItem(KEYS.spacing, spacing);
  localStorage.setItem(KEYS.canvas, canvas);
}

export function initAppearance(): void {
  migrateIfNeeded();
  applyAppearance(getTypeface(), getMode(), getSidebarMode(), getSidebarStyle(), getSpacing(), getCanvasStyle());
  document.documentElement.setAttribute('data-sidebar-density', getSidebarDensity());
}
