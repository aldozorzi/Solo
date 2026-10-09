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
import { DARK_THEMES, SOLO_STORAGE_KEY, THEMES } from '@/lib/theme';

export { THEMES } from '@/lib/theme';
export type { ThemeName } from '@/lib/theme';

const STORAGE_KEY = SOLO_STORAGE_KEY;

type SystemTheme = 'dark' | 'light';

type ThemeContextValue = {
  theme: string;
  resolvedTheme: string;
  systemTheme: SystemTheme;
  themes: string[];
  setTheme: (theme: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): SystemTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: string, system: SystemTheme): string {
  return theme === 'system' ? system : theme;
}

function applyTheme(theme: string, system: SystemTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const applied = resolveTheme(theme, system);
  root.classList.remove(...THEMES);
  root.classList.add(applied);
  root.style.colorScheme = DARK_THEMES.includes(applied) ? 'dark' : 'light';
}

function readStoredTheme(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'system';
  } catch {
    return 'system';
  }
}

/**
 * Script pre-hydration (SSR): vive in `@/lib/theme` ed è renderizzato dal
 * layout lato server.
 */

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [{ theme, systemTheme }, setState] = useState<{
    theme: string;
    systemTheme: SystemTheme;
  }>({ theme: 'system', systemTheme: 'light' });

  // Inizializza dal localStorage / sistema dopo il mount (il primo paint è già
  // stato gestito dallo script SSR).
  useEffect(() => {
    const stored = readStoredTheme();
    const system = getSystemTheme();
    applyTheme(stored, system);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ theme: stored, systemTheme: system });
  }, []);

  // Segue i cambi di tema di sistema (rilevanti solo con preferenza "system").
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const system: SystemTheme = mq.matches ? 'dark' : 'light';
      applyTheme(readStoredTheme(), system);
      setState({ theme: readStoredTheme(), systemTheme: system });
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Sincronizza tra tab diverse.
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = event.newValue || 'system';
      const system = getSystemTheme();
      applyTheme(next, system);
      setState({ theme: next, systemTheme: system });
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const setTheme = useCallback((next: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage non disponibile: applichiamo comunque in memoria.
    }
    const system = getSystemTheme();
    applyTheme(next, system);
    setState({ theme: next, systemTheme: system });
  }, []);

  const resolvedTheme = resolveTheme(theme, systemTheme);
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      systemTheme,
      themes: [...THEMES],
      setTheme,
    }),
    [theme, resolvedTheme, systemTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme deve essere usato dentro <ThemeProvider>');
  return ctx;
}
