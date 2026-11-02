import { ReactNode, useState } from 'react';
import { Image, ImageProps, Pressable, StyleSheet, Text, View } from 'react-native';
import { Palette, useColors, useThemedStyles } from './theme';

// Tries each URL in turn (German scan first, then English) and shows `fallback` if all fail.
export function FallbackImage({ uris, fallback = null, ...props }: Omit<ImageProps, 'source'> & { uris: (string | undefined)[]; fallback?: ReactNode }) {
  const list = [...new Set(uris.filter((u): u is string => !!u))];
  const [i, setI] = useState(0);
  if (i >= list.length) return <>{fallback}</>;
  return <Image key={list[i]} {...props} source={{ uri: list[i] }} onError={() => setI(i + 1)} />;
}

export const toEnglish = (url?: string) => url?.replace('assets.tcgdex.net/de/', 'assets.tcgdex.net/en/');


const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const eur = (n: number | null | undefined) => (n == null ? '–' : euro.format(n));

export function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function Progress({ have, need }: { have: number; need: number }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const pct = need ? Math.min(1, have / need) : 0;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: pct >= 1 ? colors.good : colors.accent }]} />
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.chip, marginRight: 6 },
  chipActive: { backgroundColor: colors.strong },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  chipTextActive: { color: colors.onStrong },
});

// Price change vs. the 30-day average in percent, or null if unknown / too small to matter.
export function trendPct(price?: number | null, avg30?: number | null) {
  if (price == null || avg30 == null || avg30 <= 0) return null;
  const pct = ((price - avg30) / avg30) * 100;
  return Math.abs(pct) < 3 ? 0 : pct;
}

export function Trend({ price, avg30, size = 11 }: { price?: number | null; avg30?: number | null; size?: number }) {
  const colors = useColors();
  const pct = trendPct(price, avg30);
  if (pct == null || pct === 0) return null;
  const up = pct > 0;
  return (
    <Text style={{ fontSize: size, fontWeight: '700', color: up ? colors.good : colors.accent }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)} %
    </Text>
  );
}
