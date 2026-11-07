import { createContext, PropsWithChildren, useContext } from 'solid-js';
import { createTheme, type ThemeState, type ThemeDefinition } from '../../hooks/useTheme';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ThemeContextValue {
  state: () => ThemeState;
  setTheme: (id: string) => void;
  toggleTheme: () => void;
  setSystemTheme: () => void;
  getThemeDef: (id: string) => ThemeDefinition | undefined;
  listThemes: () => string[];
  registerCustomThemes: (themes: Record<string, ThemeDefinition>) => void;
}

const ThemeContext = createContext<ThemeContextValue>();

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ThemeProvider(props: PropsWithChildren) {
  const theme = createTheme();

  return (
    <ThemeContext.Provider value={theme}>
      {props.children}
    </ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Re-export the hook creation for stand-alone usage
// ---------------------------------------------------------------------------
export { createTheme };
