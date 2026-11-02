import { createContext, ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

export type ThemeMode = 'system' | 'light' | 'dark';

const light = {
  bg: '#F4F5F7',
  card: '#FFFFFF',
  text: '#16181D',
  muted: '#6B7280',
  line: '#E3E5EA',
  accent: '#E3350D',
  good: '#16A34A',
  goodSoft: '#DCFCE7',
  chip: '#ECEEF2',
  strong: '#16181D', // filled buttons / active chips
  onStrong: '#FFFFFF',
  hero: '#16181D', // dark summary card (Slabs)
  warnBg: '#FEF3C7',
  warnText: '#92400E',
};

export type Palette = typeof light;

const dark: Palette = {
  bg: '#0E1013',
  card: '#1A1D22',
  text: '#F1F2F4',
  muted: '#9AA1AC',
  line: '#2B3038',
  accent: '#F04A24',
  good: '#22C55E',
  goodSoft: '#14532D',
  chip: '#272B32',
  strong: '#F1F2F4',
  onStrong: '#111317',
  hero: '#272B32',
  warnBg: '#3B2F10',
  warnText: '#FCD34D',
};

const ThemeContext = createContext<{ colors: Palette; dark: boolean }>({ colors: light, dark: false });

export function ThemeProvider({ mode, children }: { mode: ThemeMode; children: ReactNode }) {
  const system = useColorScheme();
  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');
  const value = useMemo(() => ({ colors: isDark ? dark : light, dark: isDark }), [isDark]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
export const useColors = () => useContext(ThemeContext).colors;

// Styles are built per palette and cached, so each theme's StyleSheet is created once.
const cache = new WeakMap<object, WeakMap<Palette, unknown>>();
export function useThemedStyles<T>(make: (c: Palette) => T): T {
  const colors = useColors();
  let perFn = cache.get(make);
  if (!perFn) cache.set(make, (perFn = new WeakMap()));
  if (!perFn.has(colors)) perFn.set(colors, make(colors));
  return perFn.get(colors) as T;
}
