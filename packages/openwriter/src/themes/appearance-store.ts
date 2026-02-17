export type ThemeName = 'ink' | 'novel' | 'mono' | 'editorial' | 'studio' | 'calm' | 'prose' | 'craft' | 'literata' | 'swiss';
export type ThemeMode = 'light' | 'dark';
export type SidebarMode = 'default' | 'timeline' | 'board' | 'shelf';
export type SidebarStyle = 'default' | 'frost' | 'minimal' | 'terminal';
export type CanvasStyle = 'seamless' | 'outline' | 'raised' | 'page';
export type TypographyPreset = 'default' | 'butterick' | 'web' | 'blog';

export interface ThemeInfo {
  id: ThemeName;
  label: string;
  description: string;
  swatch: { light: string; dark: string };
}

export const THEMES: ThemeInfo[] = [
  { id: 'ink', label: 'Ink', description: 'Charter + Inter', swatch: { light: '#5b7a9d', dark: '#7d9bba' } },
  { id: 'novel', label: 'Novel', description: 'Source Serif 4 + Newsreader', swatch: { light: '#a68b6b', dark: '#c4a882' } },
  { id: 'mono', label: 'Mono', description: 'IBM Plex Mono + Sans', swatch: { light: '#787878', dark: '#a0a0a0' } },
  { id: 'editorial', label: 'Editorial', description: 'Crimson Pro + Playfair', swatch: { light: '#9e6b6b', dark: '#b88a8a' } },
  { id: 'studio', label: 'Studio', description: 'Inter everywhere', swatch: { light: '#8b7baa', dark: '#a899c4' } },
  { id: 'calm', label: 'Calm', description: 'Inter warm tones', swatch: { light: '#8a9e6b', dark: '#a4b886' } },
  { id: 'prose', label: 'Prose', description: 'Libre Baskerville + Inter', swatch: { light: '#6b9e95', dark: '#8ab8af' } },
  { id: 'craft', label: 'Craft', description: 'Space Grotesk + Mono', swatch: { light: '#7b6b9e', dark: '#9a8ab8' } },
  { id: 'literata', label: 'Literata', description: 'Literata + Inter', swatch: { light: '#b09070', dark: '#c8a88a' } },
  { id: 'swiss', label: 'Swiss', description: 'DM Sans + DM Serif', swatch: { light: '#c47a6b', dark: '#d49a8c' } },
];

export const SIDEBAR_MODES: { id: SidebarMode; label: string; icon: string }[] = [
  { id: 'default', label: 'Tree', icon: 'tree' },
  { id: 'timeline', label: 'Timeline', icon: 'timeline' },
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'shelf', label: 'Shelf', icon: 'shelf' },
];

export const SIDEBAR_STYLES: { id: SidebarStyle; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'frost', label: 'Frost' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'terminal', label: 'Terminal' },
];

export const CANVAS_STYLES: { id: CanvasStyle; label: string }[] = [
  { id: 'seamless', label: 'Seamless' },
  { id: 'outline', label: 'Outline' },
  { id: 'raised', label: 'Raised' },
  { id: 'page', label: 'Page' },
];

export const TYPOGRAPHY_PRESETS: { id: TypographyPreset; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'web', label: 'Web' },
  { id: 'blog', label: 'Blog' },
  { id: 'butterick', label: 'Butterick' },
];

const KEYS = {
  theme: 'ow-theme',
  mode: 'ow-theme-mode',
  sidebarMode: 'ow-sidebar-mode',
  sidebarStyle: 'ow-sidebar-style',
  typography: 'ow-typography',
  canvas: 'ow-canvas',
} as const;

export function getTheme(): ThemeName {
  const stored = localStorage.getItem(KEYS.theme);
  if (stored && THEMES.some(t => t.id === stored)) return stored as ThemeName;
  return 'ink';
}

export function getMode(): ThemeMode {
  const stored = localStorage.getItem(KEYS.mode);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getSidebarMode(): SidebarMode {
  const stored = localStorage.getItem(KEYS.sidebarMode);
  if (stored && SIDEBAR_MODES.some(m => m.id === stored)) return stored as SidebarMode;
  return 'default';
}

export function getSidebarStyle(): SidebarStyle {
  const stored = localStorage.getItem(KEYS.sidebarStyle);
  if (stored && SIDEBAR_STYLES.some(s => s.id === stored)) return stored as SidebarStyle;
  return 'default';
}

export function getTypography(): TypographyPreset {
  const stored = localStorage.getItem(KEYS.typography);
  if (stored && TYPOGRAPHY_PRESETS.some(t => t.id === stored)) return stored as TypographyPreset;
  return 'default';
}

export function getCanvasStyle(): CanvasStyle {
  const stored = localStorage.getItem(KEYS.canvas);
  if (stored && CANVAS_STYLES.some(c => c.id === stored)) return stored as CanvasStyle;
  return 'seamless';
}

export function applyAppearance(theme: ThemeName, mode: ThemeMode, sidebarMode: SidebarMode, sidebarStyle: SidebarStyle, typography: TypographyPreset = 'default', canvas: CanvasStyle = 'seamless'): void {
  const el = document.documentElement;
  el.setAttribute('data-theme', theme);
  el.setAttribute('data-mode', mode);
  el.setAttribute('data-sidebar-mode', sidebarMode);
  el.setAttribute('data-sidebar-style', sidebarStyle);
  if (typography === 'default') {
    el.removeAttribute('data-typography');
  } else {
    el.setAttribute('data-typography', typography);
  }
  if (canvas === 'seamless') {
    el.removeAttribute('data-canvas');
  } else {
    el.setAttribute('data-canvas', canvas);
  }
  localStorage.setItem(KEYS.theme, theme);
  localStorage.setItem(KEYS.mode, mode);
  localStorage.setItem(KEYS.sidebarMode, sidebarMode);
  localStorage.setItem(KEYS.sidebarStyle, sidebarStyle);
  localStorage.setItem(KEYS.typography, typography);
  localStorage.setItem(KEYS.canvas, canvas);
}

export function initAppearance(): void {
  applyAppearance(getTheme(), getMode(), getSidebarMode(), getSidebarStyle(), getTypography(), getCanvasStyle());
}
