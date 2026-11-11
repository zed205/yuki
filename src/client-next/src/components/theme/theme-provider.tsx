'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  BUILTIN_THEMES,
  applyTheme,
  detectSystemPreference,
  loadPersistedTheme,
  persistTheme,
  type ThemeDefinition,
  type ThemeState,
} from '@/lib/theme';

interface ThemeContextValue {
  state: ThemeState;
  setTheme: (id: string) => void;
  toggleTheme: () => void;
  setSystemTheme: () => void;
  getThemeDef: (id: string) => ThemeDefinition | undefined;
  listThemes: () => string[];
  registerCustomThemes: (themes: Record<string, ThemeDefinition>) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [customThemes, setCustomThemes] = useState<
    Record<string, ThemeDefinition>
  >({});
  const [state, setState] = useState<ThemeState>({
    activeThemeId: null,
    isDark: true,
    systemPreference: 'dark',
    isApplying: false,
  });

  // Initialize from persistence / system preference on mount
  useEffect(() => {
    const persisted = loadPersistedTheme();
    const initial =
      persisted && persisted !== 'system'
        ? persisted
        : detectSystemPreference() === 'dark'
          ? 'yuki-dark'
          : 'yuki-light';

    const theme = applyTheme(initial);
    setState({
      activeThemeId: initial,
      isDark: theme ? theme.type === 'dark' : true,
      systemPreference: detectSystemPreference(),
      isApplying: false,
    });
  }, []);

  // Follow OS preference when active theme is 'system'
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const pref: 'dark' | 'light' = e.matches ? 'dark' : 'light';
      setState((s) => ({ ...s, systemPreference: pref }));
      if (state.activeThemeId === 'system') {
        const themeId = pref === 'dark' ? 'yuki-dark' : 'yuki-light';
        const theme = applyTheme(themeId, customThemes);
        setState((s) => ({
          ...s,
          activeThemeId: themeId,
          isDark: theme ? theme.type === 'dark' : s.isDark,
        }));
      }
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [state.activeThemeId, customThemes]);

  const setTheme = useCallback(
    (themeId: string) => {
      const resolved =
        themeId === 'system'
          ? detectSystemPreference() === 'dark'
            ? 'yuki-dark'
            : 'yuki-light'
          : themeId;
      const theme = applyTheme(resolved, customThemes);
      if (!theme) return;
      if (themeId !== 'system') persistTheme(themeId);
      setState((s) => ({
        ...s,
        activeThemeId: themeId,
        isDark: theme.type === 'dark',
      }));
    },
    [customThemes],
  );

  const toggleTheme = useCallback(() => {
    setTheme(state.isDark ? 'yuki-light' : 'yuki-dark');
  }, [setTheme, state.isDark]);

  const setSystemTheme = useCallback(() => {
    setTheme('system');
  }, [setTheme]);

  const getThemeDef = useCallback(
    (id: string) => BUILTIN_THEMES[id] ?? customThemes[id] ?? undefined,
    [customThemes],
  );

  const listThemes = useCallback(
    () => [...Object.keys(BUILTIN_THEMES), ...Object.keys(customThemes)],
    [customThemes],
  );

  const registerCustomThemes = useCallback(
    (themes: Record<string, ThemeDefinition>) => setCustomThemes(themes),
    [],
  );

  const value = useMemo(
    () => ({
      state,
      setTheme,
      toggleTheme,
      setSystemTheme,
      getThemeDef,
      listThemes,
      registerCustomThemes,
    }),
    [
      state,
      setTheme,
      toggleTheme,
      setSystemTheme,
      getThemeDef,
      listThemes,
      registerCustomThemes,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a <ThemeProvider>');
  return ctx;
}
