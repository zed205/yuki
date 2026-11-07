import { createSignal, createEffect, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';

// ---------------------------------------------------------------------------
// Theme definitions — importable JSON manifests
// ---------------------------------------------------------------------------

import yukiDark from '../theme/custom-themes/yuki-dark.json';
import yukiLight from '../theme/custom-themes/yuki-light.json';

export type ColorKey = keyof typeof yukiDark.colors;

export interface ThemeDefinition {
  name: string;
  id: string;
  type: 'dark' | 'light';
  colors: Record<string, string>;
}

export interface ThemeState {
  activeThemeId: string | null;
  isDark: boolean;
  systemPreference: 'dark' | 'light';
  isApplying: boolean;
}

// Map of known built-in themes
const BUILTIN_THEMES: Record<string, ThemeDefinition> = {
  'yuki-dark': yukiDark as unknown as ThemeDefinition,
  'yuki-light': yukiLight as unknown as ThemeDefinition,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a CSS variable (without the `var()` wrapper) from the document root
 * and return the raw value string.
 */
function getCSSVar(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * Apply a full set of CSS custom properties to the document root.
 * Every key in the `colors` record becomes a CSS variable.
 */
function applyCSSVariables(colors: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--${key}`, value);
  }
}

/**
 * Apply the semantic color tokens (background, foreground, etc.) that
 * Tailwind's `hsl(var(...))` utilities expect.
 */
function applySemanticColors(colors: Record<string, string>): void {
  applyCSSVariables({
    'background': colors['background'] ?? '222 84% 4.9%',
    'foreground': colors['foreground'] ?? '210 40% 96%',
    'card': colors['card'] ?? '222 84% 4.9%',
    'card-foreground': colors['card-foreground'] ?? '210 40% 96%',
    'popover': colors['popover'] ?? '222 84% 4.9%',
    'popover-foreground': colors['popover-foreground'] ?? '210 40% 96%',
    'primary': colors['primary'] ?? '217 91 60',
    'primary-foreground': colors['primary-foreground'] ?? '222 47 11',
    'secondary': colors['secondary'] ?? '217 33 18',
    'secondary-foreground': colors['secondary-foreground'] ?? '210 40 98',
    'muted': colors['muted'] ?? '217 33 18',
    'muted-foreground': colors['muted-foreground'] ?? '215 20 65',
    'accent': colors['accent'] ?? '217 33 18',
    'accent-foreground': colors['accent-foreground'] ?? '210 40 98',
    'destructive': colors['destructive'] ?? '0 63 31',
    'destructive-foreground': colors['destructive-foreground'] ?? '210 40 98',
    'border': colors['border'] ?? '217 33 18',
    'input': colors['input'] ?? '217 33 18',
    'ring': colors['ring'] ?? '213 27 84',
  });
}

/**
 * Apply custom brand-level overrides (message bubbles, scrollbars, etc.)
 * that live outside the semantic token system.
 */
function applyBrandOverrides(colors: Record<string, string>): void {
  applyCSSVariables({
    'yuki-user-bubble-bg': colors['user-bubble-bg'] ?? '217 33 18',
    'yuki-user-bubble-border': colors['user-bubble-border'] ?? '217 33 23',
    'yuki-user-bubble-text': colors['user-bubble-text'] ?? '0 0 98',
    'yuki-asst-bubble-bg': colors['assistant-bubble-bg'] ?? '222 47 11',
    'yuki-asst-bubble-border': colors['assistant-bubble-border'] ?? '217 14 22',
    'yuki-asst-bubble-text': colors['assistant-bubble-text'] ?? '210 40 96',
    'yuki-thinking-border': colors['thinking-border'] ?? 'hsla(45, 90%, 55%, 0.2)',
    'yuki-thinking-bg': colors['thinking-bg'] ?? '222 47 11',
    'yuki-thinking-text': colors['thinking-text'] ?? '215 20 65',
    'yuki-thinking-accent': colors['thinking-accent'] ?? '45 90 55',
    'yuki-heading': colors['heading'] ?? '35 95 45',
    'yuki-highlight': colors['highlight'] ?? '217 91 60',
    'yuki-code-bg': colors['code-bg'] ?? '217 33 17',
    'yuki-code-inline-bg': colors['code-inline-bg'] ?? '217 33 17',
    'yuki-blockquote-bg': colors['blockquote-bg'] ?? '217 33 11',
    'yuki-blockquote-border': colors['blockquote-border'] ?? '30 33 32',
    'yuki-scrollbar-thumb': colors['scrollbar-thumb'] ?? '217 14 33',
    'yuki-scrollbar-thumb-hover': colors['scrollbar-thumb-hover'] ?? '217 14 43',
  });
}

/**
 * Detect the operating system / browser preference for dark mode.
 */
function detectSystemPreference(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Persist theme choice to localStorage so it survives page reloads.
 */
const THEME_STORAGE_KEY = 'yuki-theme';

function loadPersistedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistTheme(themeId: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // Storage may be full or unavailable
  }
}

// ---------------------------------------------------------------------------
// Solid Hook
// ---------------------------------------------------------------------------

export function createTheme() {
  const [state, setState] = createSignal<ThemeState>({
    activeThemeId: loadPersistedTheme() ?? 'yuki-dark',
    isDark: detectSystemPreference() === 'dark',
    systemPreference: detectSystemPreference(),
    isApplying: false,
  });

  const [customThemes, setCustomThemes] = createStore<Record<string, ThemeDefinition>>({});

  // Register custom themes (loaded at runtime from the custom-themes directory)
  function registerCustomThemes(themes: Record<string, ThemeDefinition>): void {
    setCustomThemes(themes);
  }

  // -----------------------------------------------------------------------
  // Apply the currently-active theme whenever activeThemeId changes
  // -----------------------------------------------------------------------
  createEffect(() => {
    const themeId = state().activeThemeId;
    if (!themeId) return;

    setState((s) => ({ ...s, isApplying: true }));

    const theme =
      BUILTIN_THEMES[themeId] ??
      (customThemes as Record<string, ThemeDefinition>)[themeId];

    if (!theme) {
      setState((s) => ({ ...s, isApplying: false }));
      return;
    }

    const colors = theme.colors as Record<string, string>;

    // Apply dark/light class on <html>
    document.documentElement.classList.toggle('dark', theme.type === 'dark');
    document.documentElement.classList.toggle('light', theme.type === 'light');

    // Apply CSS variables — both semantic tokens and brand overrides
    applySemanticColors(colors);
    applyBrandOverrides(colors);

    setState((s) => ({
      ...s,
      isDark: theme.type === 'dark',
      isApplying: false,
    }));
  });

  // -----------------------------------------------------------------------
  // System preference listener
  // -----------------------------------------------------------------------
  onMount(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');

    const handler = (e: MediaQueryListEvent) => {
      const pref: 'dark' | 'light' = e.matches ? 'dark' : 'light';
      setState((s) => ({
        ...s,
        systemPreference: pref,
        // If user hasn't picked a theme yet (or chose "system"), flip along
        // with the system.  The persisted theme ID is the last user choice;
        // we re-evaluate on mount via the `system` sentinel.
      }));

      if (state().activeThemeId === 'system') {
        const themeId = pref === 'dark' ? 'yuki-dark' : 'yuki-light';
        setState((s) => ({ ...s, activeThemeId: themeId }));
      }
    };

    mql.addEventListener('change', handler);

    // Cleanup on unmount
    return () => mql.removeEventListener('change', handler);
  });

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Set the active theme by ID. */
  function setTheme(themeId: string): void {
    const theme =
      BUILTIN_THEMES[themeId] ??
      (customThemes as Record<string, ThemeDefinition>)[themeId];

    if (!theme) return;

    setState((s) => ({ ...s, activeThemeId: themeId }));
    persistTheme(themeId);
  }

  /** Toggle between the currently loaded dark and light themes. */
  function toggleTheme(): void {
    const current = state().activeThemeId;
    const next = state().isDark ? 'yuki-light' : 'yuki-dark';
    setTheme(next);
  }

  /** Switch to the OS preference (dark or light). */
  function setSystemTheme(): void {
    setTheme('system');
  }

  /** Get the currently loaded theme definition (or undefined). */
  function getThemeDef(themeId: string): ThemeDefinition | undefined {
    return (
      BUILTIN_THEMES[themeId] ??
      (customThemes as Record<string, ThemeDefinition>)[themeId] ??
      undefined
    );
  }

  /** List all available theme IDs (built-in + registered custom). */
  function listThemes(): string[] {
    return [
      ...Object.keys(BUILTIN_THEMES),
      ...Object.keys(customThemes),
    ];
  }

  // Initialize from persisted value or fallback
  onMount(() => {
    const persisted = loadPersistedTheme();
    if (persisted && persisted !== 'system' && persisted !== state().activeThemeId) {
      setState((s) => ({ ...s, activeThemeId: persisted }));
    }
  });

  return {
    /** Reactive state */
    state,
    /** Theme switching */
    setTheme,
    toggleTheme,
    setSystemTheme,
    /** Theme metadata */
    getThemeDef,
    listThemes,
    /** Custom theme registry */
    registerCustomThemes,
  };
}
