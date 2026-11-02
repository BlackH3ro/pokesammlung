import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { cardImages, readCachedSet, SetBrief } from './api';
import { cardOwnedAny, CardMeta, useCollection } from './collection';
import { Chip, eur, FallbackImage, naturalCompare } from './ui';
import { rarityInfo } from './rarity';
import ValueChart from './ValueChart';
import { shareText, stamp, toCsv } from './backup';
import { Palette, useColors, useThemedStyles } from './theme';

type Sort = 'value' | 'rarity' | 'name' | 'set';

type Entry = { key: string; card: CardMeta; variantLabel: string; price: number | null; count: number; rank: number; rarity: string };

export default function CollectionScreen({ onOpenSet }: { onOpenSet: (s: SetBrief) => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const col = useCollection();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('value');
  const [doubles, setDoubles] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Cards ticked before the app remembered card details: fill them in from cached sets.
  useEffect(() => {
    Object.keys(col.started).forEach(async (setId) => {
      const set = await readCachedSet(setId);
      if (!set) return;
      col.remember(
        set.cards.filter((c) => cardOwnedAny(c, col.owned)).map((c) => ({ ...c, setId: set.id, setName: set.name })),
      );
    });
  }, []);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const [key, count] of Object.entries(col.owned)) {
      const [cardId, vKey] = key.split('|');
      const card = col.meta[cardId];
      if (!card) continue;
      const v = card.variants.find((x) => x.key === vKey);
      // Classic Collection reprints carry no rarity in the data.
      const r = rarityInfo(card.rarity || (card.id.startsWith('30th-c-') ? 'Classic Collection' : ''));
      out.push({ key, card, variantLabel: v?.label ?? vKey, price: v?.price ?? null, count, rank: r.rank, rarity: r.short });
    }
    return out;
  }, [col.owned, col.meta]);

  const totalValue = entries.reduce((s, e) => s + (e.price ?? 0) * e.count, 0);
  const totalCards = entries.reduce((s, e) => s + e.count, 0);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let filtered = q
      ? entries.filter((e) => e.card.name.toLowerCase().includes(q) || e.card.setName.toLowerCase().includes(q))
      : entries.slice();
    if (doubles) filtered = filtered.filter((e) => e.count > 1);
    const cmp: Record<Sort, (a: Entry, b: Entry) => number> = {
      value: (a, b) => (b.price ?? 0) * b.count - (a.price ?? 0) * a.count,
      rarity: (a, b) => b.rank - a.rank || (b.price ?? 0) - (a.price ?? 0),
      name: (a, b) => naturalCompare(a.card.name, b.card.name),
      set: (a, b) => naturalCompare(a.card.setName, b.card.setName) || naturalCompare(a.card.localId, b.card.localId),
    };
    return filtered.sort(cmp[sort]);
  }, [entries, query, sort, doubles]);

  const doubleEntries = entries.filter((e) => e.count > 1);
  const doubleCount = doubleEntries.reduce((s, e) => s + e.count - 1, 0);
  const doubleValue = doubleEntries.reduce((s, e) => s + (e.count - 1) * (e.price ?? 0), 0);

  const exportCsv = () => {
    const rows = entries
      .slice()
      .sort((a, b) => naturalCompare(a.card.setName, b.card.setName) || naturalCompare(a.card.localId, b.card.localId));
    const money = (n: number | null) => (n != null ? n.toFixed(2).replace('.', ',') : '');
    const csv = toCsv([
      ['Set', 'Nr.', 'Name', 'Variante', 'Seltenheit', 'Anzahl', 'Preis (EUR)', 'Wert (EUR)'],
      ...rows.map((e) => [
        e.card.setName,
        e.card.localId,
        e.card.name,
        e.variantLabel,
        e.card.rarity,
        e.count,
        money(e.price),
        money(e.price != null ? e.price * e.count : null),
      ]),
    ]);
    shareText(`sammlung-${stamp()}.csv`, csv, 'text/csv').catch(() => {});
  };

  const shareTrades = () => {
    const rows = doubleEntries
      .slice()
      .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
      .map((e) => `${e.count - 1}× ${e.card.name} (${e.card.setName} ${e.card.localId}, ${e.variantLabel})${e.price != null ? ` – ${eur(e.price)}` : ''}`);
    const text = [`Tauschliste – ${doubleCount} Karten, ca. ${eur(doubleValue)}`, '', ...rows].join('\n');
    shareText(`tauschliste-${stamp()}.txt`, text, 'text/plain').catch(() => {});
  };

  const header = (
    <View>
      <Text style={styles.title}>Sammlung</Text>
      <View style={styles.summary}>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryLabel}>Gesamtwert</Text>
          <Text style={styles.summaryValue}>{eur(totalValue)}</Text>
        </View>
        <View>
          <Text style={styles.summaryLabel}>Karten</Text>
          <Text style={styles.summaryCount}>{totalCards}</Text>
        </View>
      </View>
      <ValueChart history={col.history} />
      <Pressable style={styles.statsToggle} onPress={() => setShowStats((v) => !v)}>
        <Text style={styles.statsToggleText}>Statistik {showStats ? '▴' : '▾'}</Text>
      </Pressable>
      {showStats && <Stats entries={entries} />}
      <TextInput
        style={styles.search}
        placeholder="Karte oder Set suchen"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 10 }}>
        <Chip label="Wert ↓" active={sort === 'value'} onPress={() => setSort('value')} />
        <Chip label="Seltenheit" active={sort === 'rarity'} onPress={() => setSort('rarity')} />
        <Chip label="Name" active={sort === 'name'} onPress={() => setSort('name')} />
        <Chip label="Set" active={sort === 'set'} onPress={() => setSort('set')} />
      </ScrollView>
      <View style={styles.actions}>
        <Chip label={`Doppelte (${doubleCount})`} active={doubles} onPress={() => setDoubles((d) => !d)} />
        <View style={{ flex: 1 }} />
        {doubles && doubleCount > 0 ? (
          <Pressable onPress={shareTrades} hitSlop={6}>
            <Text style={styles.link}>Tauschliste teilen</Text>
          </Pressable>
        ) : (
          entries.length > 0 && (
            <Pressable onPress={exportCsv} hitSlop={6}>
              <Text style={styles.link}>Als CSV exportieren</Text>
            </Pressable>
          )
        )}
      </View>
      {doubles && doubleCount > 0 && (
        <Text style={styles.meta}>
          {doubleCount} doppelte Karten im Wert von ca. {eur(doubleValue)} – gezählt wird alles über dem ersten Exemplar.
        </Text>
      )}
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32, maxWidth: 800, width: '100%', alignSelf: 'center' }}
      data={list}
      keyExtractor={(e) => e.key}
      ListHeaderComponent={header}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={
        <Text style={styles.empty}>
          {entries.length ? 'Nichts gefunden.' : 'Noch keine Karten. Scanne Karten oder hake sie in einem Set ab.'}
        </Text>
      }
      renderItem={({ item }) => {
        return (
          <Pressable
            style={styles.row}
            onPress={() => onOpenSet({ id: item.card.setId, name: item.card.setName, official: 0, total: 0 })}
          >
            <FallbackImage key={item.key} uris={cardImages(item.card)} style={styles.thumb} fallback={<View style={styles.thumb} />} />
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                {!!item.rarity && (
                  <View style={styles.rarity}>
                    <Text style={styles.rarityText}>{item.rarity}</Text>
                  </View>
                )}
                <Text style={[styles.name, { flexShrink: 1 }]} numberOfLines={1}>
                  {item.card.name}
                </Text>
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {item.card.setName} · {item.card.localId}
                {item.card.rarity ? ` · ${item.card.rarity}` : ''}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {item.variantLabel}
                {item.count > 1 ? ` · ${item.count}×` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.value}>{eur(item.price != null ? item.price * item.count : null)}</Text>
              {item.count > 1 && item.price != null && <Text style={styles.meta}>je {eur(item.price)}</Text>}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

function Stats({ entries }: { entries: Entry[] }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const bySet = new Map<string, { name: string; value: number; count: number }>();
  const byRarity = new Map<string, { rank: number; count: number }>();
  for (const e of entries) {
    const s = bySet.get(e.card.setId) ?? { name: e.card.setName, value: 0, count: 0 };
    s.value += (e.price ?? 0) * e.count;
    s.count += e.count;
    bySet.set(e.card.setId, s);
    if (e.rarity) {
      const r = byRarity.get(e.rarity) ?? { rank: e.rank, count: 0 };
      r.count += e.count;
      byRarity.set(e.rarity, r);
    }
  }
  const sets = [...bySet.values()].sort((a, b) => b.value - a.value).slice(0, 6);
  const max = sets[0]?.value || 1;
  const rarities = [...byRarity.entries()].sort((a, b) => b[1].rank - a[1].rank);
  const top = entries.slice().sort((a, b) => (b.price ?? 0) - (a.price ?? 0)).slice(0, 5);
  const cards = entries.reduce((s, e) => s + e.count, 0);
  const avg = cards ? entries.reduce((s, e) => s + (e.price ?? 0) * e.count, 0) / cards : 0;

  return (
    <View style={styles.statsBox}>
      <Text style={styles.statsH}>Wert pro Set</Text>
      {sets.map((s) => (
        <View key={s.name} style={{ marginBottom: 6 }}>
          <View style={styles.statsRow}>
            <Text style={styles.statsLabel} numberOfLines={1}>
              {s.name} · {s.count} Karten
            </Text>
            <Text style={styles.statsValue}>{eur(s.value)}</Text>
          </View>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${(s.value / max) * 100}%` }]} />
          </View>
        </View>
      ))}
      <Text style={styles.statsH}>Teuerste Karten</Text>
      {top.map((e) => (
        <View key={e.key} style={styles.statsRow}>
          <Text style={styles.statsLabel} numberOfLines={1}>
            {e.card.name} · {e.card.setName}
          </Text>
          <Text style={styles.statsValue}>{eur(e.price)}</Text>
        </View>
      ))}
      {rarities.length > 0 && <Text style={styles.statsH}>Seltenheiten</Text>}
      <View style={styles.rarityWrap}>
        {rarities.map(([short, r]) => (
          <View key={short} style={styles.rarityPill}>
            <Text style={styles.rarityPillText}>
              {short} <Text style={{ color: colors.muted }}>{r.count}</Text>
            </Text>
          </View>
        ))}
      </View>
      <Text style={[styles.meta, { marginTop: 10 }]}>Durchschnittswert pro Karte: {eur(avg)}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  link: { color: colors.accent, fontWeight: '600', fontSize: 13 },
  statsToggle: { alignSelf: 'flex-start', paddingVertical: 8 },
  statsToggleText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  statsBox: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 4 },
  statsH: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: 6, marginBottom: 8 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 3 },
  statsLabel: { flex: 1, fontSize: 13, color: colors.text },
  statsValue: { fontSize: 13, fontWeight: '700', color: colors.text },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  rarityWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  rarityPill: { backgroundColor: colors.chip, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  rarityPillText: { fontSize: 12, fontWeight: '700', color: colors.text },
  title: { fontSize: 30, fontWeight: '800', color: colors.text, marginBottom: 12 },
  summary: { flexDirection: 'row', backgroundColor: colors.accent, borderRadius: 14, padding: 16, alignItems: 'flex-end' },
  summaryLabel: { color: '#FFE4DC', fontSize: 13 },
  summaryValue: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 2 },
  summaryCount: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 2, textAlign: 'right' },
  search: {
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginTop: 16,
    color: colors.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  empty: { color: colors.muted, marginTop: 24, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 8, marginBottom: 6, gap: 10 },
  thumb: { width: 44, height: 61, borderRadius: 4, backgroundColor: colors.chip },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rarity: { backgroundColor: colors.strong, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  rarityText: { color: colors.onStrong, fontSize: 10, fontWeight: '700' },
  meta: { fontSize: 12, color: colors.muted, marginTop: 1 },
  value: { fontSize: 15, fontWeight: '700', color: colors.text },
});
