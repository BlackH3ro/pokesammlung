import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import type { ValuePoint } from './collection';
import { Palette, useColors, useThemedStyles } from './theme';
import { Chip, eur } from './ui';

type Range = 7 | 30 | 0;
const HEIGHT = 110;

const day = (d: string) => {
  const [, m, dd] = d.split('-');
  return `${dd}.${m}.`;
};

// Daily total value (cards + slabs) as an area chart.
export default function ValueChart({ history }: { history: ValuePoint[] }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const [range, setRange] = useState<Range>(30);
  const [width, setWidth] = useState(0);

  const points = (range ? history.slice(-range) : history).map((p) => ({ d: p.d, v: p.cards + p.slabs }));
  const first = points[0]?.v ?? 0;
  const last = points[points.length - 1]?.v ?? 0;
  const diff = last - first;
  const pct = first > 0 ? (diff / first) * 100 : 0;
  const up = diff >= 0;

  let line = '';
  let area = '';
  if (points.length >= 2 && width > 0) {
    const vs = points.map((p) => p.v);
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const span = max - min || 1;
    const xy = points.map((p, i) => [(i / (points.length - 1)) * width, 6 + (1 - (p.v - min) / span) * (HEIGHT - 12)]);
    line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    area = `${line} L${width},${HEIGHT} L0,${HEIGHT} Z`;
  }
  const stroke = up ? colors.good : colors.accent;

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={styles.title}>Wertverlauf</Text>
        <Text style={[styles.change, { color: stroke }]}>
          {points.length >= 2 ? `${up ? '+' : ''}${eur(diff)} (${up ? '+' : ''}${pct.toFixed(1).replace('.', ',')} %)` : ''}
        </Text>
      </View>
      <View style={{ height: HEIGHT }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {points.length >= 2 ? (
          <Svg width={width} height={HEIGHT}>
            <Defs>
              <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={stroke} stopOpacity={0.35} />
                <Stop offset="1" stopColor={stroke} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={area} fill="url(#fill)" />
            <Path d={line} stroke={stroke} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
          </Svg>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Der Verlauf startet heute ({eur(last)}). Ab morgen siehst du hier die Kurve – die App speichert den Wert jeden Tag.
            </Text>
          </View>
        )}
      </View>
      <View style={styles.foot}>
        <Text style={styles.date}>{points[0] ? day(points[0].d) : ''}</Text>
        <View style={{ flexDirection: 'row' }}>
          <Chip label="7 T" active={range === 7} onPress={() => setRange(7)} />
          <Chip label="30 T" active={range === 30} onPress={() => setRange(30)} />
          <Chip label="Alles" active={range === 0} onPress={() => setRange(0)} />
        </View>
        <Text style={styles.date}>{points.length > 1 ? day(points[points.length - 1].d) : ''}</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    box: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginTop: 12 },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
    title: { fontSize: 15, fontWeight: '700', color: colors.text },
    change: { fontSize: 14, fontWeight: '700' },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 18 },
    foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    date: { fontSize: 11, color: colors.muted, width: 44 },
  });
