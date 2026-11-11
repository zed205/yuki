/**
 * Yuki theme engine — ported from client-v2 hooks/useTheme.ts.
 * Pure helpers (no React) + definitions consumed by ThemeProvider.
 */

import yukiDark from '../theme/custom-themes/yuki-dark.json';
import yukiLight from '../theme/custom-themes/yuki-light.json';

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

export const BUILTIN_THEMES: Record<string, ThemeDefinition> = {
  'yuki-dark': yukiDark as unknown as ThemeDefinition,
  'yuki-light': yukiLight as unknown as ThemeDefinition,
};

const THEME_STORAGE_KEY = 'yuki-theme';

export function loadPersistedTheme(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistTheme(themeId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // storage may be full or unavailable
  }
}

export function detectSystemPreference(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyCSSVariables(colors: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--${key}`, value);
  }
}

/**
 * Map theme color tokens onto shadcn/Tailwind semantic variables.
 * Values are full CSS colors (hsl(...)) so they slot straight into the
 * `var(--*)` tokens declared in globals.css.
 */
function applySemanticColors(colors: Record<string, string>): void {
  applyCSSVariables({
    background: colors['background'] ?? 'hsl(222, 84%, 4.9%)',
    foreground: colors['foreground'] ?? 'hsl(210, 40%, 96%)',
    card: colors['card'] ?? 'hsl(222, 84%, 4.9%)',
    'card-foreground': colors['card-foreground'] ?? 'hsl(210, 40%, 96%)',
    popover: colors['popover'] ?? 'hsl(222, 84%, 4.9%)',
    'popover-foreground': colors['popover-foreground'] ?? 'hsl(210, 40%, 96%)',
    primary: colors['primary'] ?? 'hsl(217, 91%, 60%)',
    'primary-foreground': colors['primary-foreground'] ?? 'hsl(222, 47%, 11%)',
    secondary: colors['secondary'] ?? 'hsl(217, 33%, 18%)',
    'secondary-foreground': colors['secondary-foreground'] ?? 'hsl(210, 40%, 98%)',
    muted: colors['muted'] ?? 'hsl(217, 33%, 18%)',
    'muted-foreground': colors['muted-foreground'] ?? 'hsl(215, 20%, 65%)',
    accent: colors['accent'] ?? 'hsl(217, 33%, 18%)',
    'accent-foreground': colors['accent-foreground'] ?? 'hsl(210, 40%, 98%)',
    destructive: colors['destructive'] ?? 'hsl(0, 63%, 31%)',
    'destructive-foreground': colors['destructive-foreground'] ?? 'hsl(210, 40%, 98%)',
    border: colors['border'] ?? 'hsl(217, 33%, 18%)',
    input: colors['input'] ?? 'hsl(217, 33%, 18%)',
    ring: colors['ring'] ?? 'hsl(213, 27%, 84%)',
    // Sidebar tokens fall back to the surface tokens
    sidebar: colors['sidebar'] ?? colors['background'] ?? 'hsl(222, 84%, 4.9%)',
    'sidebar-foreground': colors['sidebar-foreground'] ?? colors['foreground'] ?? 'hsl(210, 40%, 96%)',
    'sidebar-primary': colors['sidebar-primary'] ?? colors['primary'] ?? 'hsl(217, 91%, 60%)',
    'sidebar-primary-foreground': colors['sidebar-primary-foreground'] ?? colors['primary-foreground'] ?? 'hsl(222, 47%, 11%)',
    'sidebar-accent': colors['sidebar-accent'] ?? colors['accent'] ?? 'hsl(217, 33%, 18%)',
    'sidebar-accent-foreground': colors['sidebar-accent-foreground'] ?? colors['accent-foreground'] ?? 'hsl(210, 40%, 98%)',
    'sidebar-border': colors['sidebar-border'] ?? colors['border'] ?? 'hsl(217, 33%, 18%)',
    'sidebar-ring': colors['sidebar-ring'] ?? colors['ring'] ?? 'hsl(213, 27%, 84%)',
  });
}

/**
 * Brand-level overrides (message bubbles, thinking blocks, scrollbars)
 * from yuki-brand.css.
 */
function applyBrandOverrides(colors: Record<string, string>): void {
  applyCSSVariables({
    'yuki-user-bubble-bg': colors['user-bubble-bg'] ?? 'hsl(217, 33%, 18%)',
    'yuki-user-bubble-border': colors['user-bubble-border'] ?? 'hsl(217, 33%, 23%)',
    'yuki-user-bubble-text': colors['user-bubble-text'] ?? 'hsl(0, 0%, 98%)',
    'yuki-asst-bubble-bg': colors['assistant-bubble-bg'] ?? 'hsl(222, 47%, 11%)',
    'yuki-asst-bubble-border': colors['assistant-bubble-border'] ?? 'hsl(217, 14%, 22%)',
    'yuki-asst-bubble-text': colors['assistant-bubble-text'] ?? 'hsl(210, 40%, 96%)',
    'yuki-thinking-border': colors['thinking-border'] ?? 'hsla(45, 90%, 55%, 0.2)',
    'yuki-thinking-bg': colors['thinking-bg'] ?? 'hsl(222, 47%, 11%)',
    'yuki-thinking-text': colors['thinking-text'] ?? 'hsl(215, 20%, 65%)',
    'yuki-thinking-accent': colors['thinking-accent'] ?? 'hsl(45, 90%, 55%)',
    'yuki-heading': colors['heading'] ?? '#d4760a',
    'yuki-highlight': colors['highlight'] ?? 'hsl(217, 91%, 60%)',
    'yuki-code-bg': colors['code-bg'] ?? 'hsl(217, 33%, 17%)',
    'yuki-code-inline-bg': colors['code-inline-bg'] ?? 'hsl(217, 33%, 17%)',
    'yuki-blockquote-bg': colors['blockquote-bg'] ?? 'hsl(217, 33%, 11%)',
    'yuki-blockquote-border': colors['blockquote-border'] ?? 'hsl(30, 33%, 32%)',
    'yuki-scrollbar-thumb': colors['scrollbar-thumb'] ?? 'hsl(217, 14%, 33%)',
    'yuki-scrollbar-thumb-hover': colors['scrollbar-thumb-hover'] ?? 'hsl(217, 14%, 43%)',
    // Agent status colors
    'yuki-agent-running': colors['agent-running'] ?? 'hsl(145, 72%, 45%)',
    'yuki-agent-queued': colors['agent-queued'] ?? 'hsl(45, 90%, 55%)',
    'yuki-agent-completed': colors['agent-completed'] ?? 'hsl(145, 72%, 45%)',
    'yuki-agent-cancelled': colors['agent-cancelled'] ?? 'hsl(0, 85%, 60%)',
    'yuki-agent-error': colors['agent-error'] ?? 'hsl(0, 85%, 60%)',
  });
}

/** Apply a full theme by id (built-in or previously registered). */
export function applyTheme(
  themeId: string,
  customThemes: Record<string, ThemeDefinition> = {},
): ThemeDefinition | undefined {
  if (typeof window === 'undefined') return undefined;
  const theme = BUILTIN_THEMES[themeId] ?? customThemes[themeId];
  if (!theme) return undefined;

  document.documentElement.classList.toggle('dark', theme.type === 'dark');
  document.documentElement.classList.toggle('light', theme.type === 'light');

  applySemanticColors(theme.colors);
  applyBrandOverrides(theme.colors);
  return theme;
}
