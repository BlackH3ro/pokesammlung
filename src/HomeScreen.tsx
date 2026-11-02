import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, CardHit, getCard, isMergedChild, loadSeries, readCachedSet, searchCards, Series, SetBrief, SetDetail } from './api';
import CardSheet from './CardSheet';
import { cardOwnedAny, setStats, useCollection } from './collection';
import { eur, FallbackImage, Progress, toEnglish } from './ui';
import { Palette, useColors, useThemedStyles } from './theme';

type Props = { onOpenSet: (set: SetBrief) => void };

export default function HomeScreen({ onOpenSet }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const col = useCollection();
  const [series, setSeries] = useState<Series[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState<SetDetail[]>([]);
  const [hits, setHits] = useState<CardHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [openCard, setOpenCard] = useState<{ card: Card; set: { id: string; name: string } } | null>(null);

  // Card search (German + English names) once at least 3 letters are typed.
  const cardQuery = query.trim().length >= 3 ? query.trim() : '';
  useEffect(() => {
    if (!cardQuery) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setSearching(true);
      searchCards(cardQuery)
        .then((h) => {
          if (cancelled) return;
          setHits(h);
          setShowAll(false);
        })
        .finally(() => !cancelled && setSearching(false));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [cardQuery]);

  const setNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const se of series ?? []) for (const st of se.sets) m.set(st.id, st.name);
    return m;
  }, [series]);

  // Heart in the search list: adds the card's first variant (Normal/Holo), or removes all its wishes.
  const toggleWant = async (hit: CardHit) => {
    const keys = Object.keys(col.wants).filter((k) => k.startsWith(hit.id + '|'));
    if (keys.length) return keys.forEach(col.removeWant);
    const res = await getCard(hit.id);
    if (res) col.setWant({ id: res.setId, name: res.setName }, res.card, res.card.variants[0].key, null);
  };

  const openHit = async (hit: CardHit) => {
    const res = await getCard(hit.id);
    if (res) setOpenCard({ card: res.card, set: { id: res.setId, name: res.setName } });
  };

  const load = (force = false) => {
    setError(null);
    return loadSeries(force)
      .then(setSeries)
      .catch((e) => setError(String(e.message ?? e)));
  };

  useEffect(() => {
    load();
  }, []);

  // Re-read cached details of started sets whenever the collection changes.
  const startedIds = Object.keys(col.started).join(',');
  useEffect(() => {
    Promise.all(Object.keys(col.started).filter((id) => !isMergedChild(id)).map(readCachedSet)).then((list) =>
      setMine(list.filter((s): s is SetDetail => !!s)),
    );
  }, [startedIds, col.owned]);

  const mineStats = mine
    .map((s) => ({ set: s, stats: setStats(s, col, col.mode[s.id] ?? 'master') }))
    .filter((m) => m.stats.have > 0 || m.stats.ownedValue > 0)
    // Closest to complete first.
    .sort((a, b) => b.stats.have / (b.stats.need || 1) - a.stats.have / (a.stats.need || 1));
  const totalValue = mineStats.reduce((sum, m) => sum + m.stats.ownedValue, 0);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (series ?? [])
      .map((s) => ({
        title: s.name,
        data: q ? s.sets.filter((x) => x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q)) : s.sets,
      }))
      .filter((s) => s.data.length > 0);
  }, [series, query]);

  const header = (
    <View>
      <Text style={styles.title}>Meine Sammlung</Text>
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>Sammlungswert (Cardmarket-Trend)</Text>
        <Text style={styles.summaryValue}>{eur(totalValue)}</Text>
      </View>

      {mineStats.length > 0 && <Text style={styles.section}>Meine Sets</Text>}
      {mineStats.map(({ set, stats }) => (
        <Pressable key={set.id} style={styles.mineRow} onPress={() => onOpenSet(set)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.setName}>{set.name}</Text>
            <Text style={styles.meta}>
              {Math.floor((stats.have / (stats.need || 1)) * 100)} % · {stats.have} / {stats.need} · {(col.mode[set.id] ?? 'master') === 'master' ? 'Masterset' : 'Grundset'} · fehlt{' '}
              {eur(stats.missingValue)}
            </Text>
            <View style={{ marginTop: 6 }}>
              <Progress have={stats.have} need={stats.need} />
            </View>
          </View>
          <Text style={styles.mineValue}>{eur(stats.ownedValue)}</Text>
        </Pressable>
      ))}

      <TextInput
        style={styles.search}
        placeholder="Set oder Karte suchen, z. B. 30 Jahre oder Glurak"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        clearButtonMode="while-editing"
        autoCorrect={false}
      />
      {!!cardQuery && (
        <View>
          <View style={styles.hitHead}>
            <Text style={styles.section}>Karten{hits.length ? ` (${hits.length})` : ''}</Text>
            {searching && <ActivityIndicator color={colors.accent} />}
          </View>
          {!searching && !hits.length && <Text style={styles.meta}>Keine Karten gefunden.</Text>}
          <View style={styles.hits}>
            {(showAll ? hits : hits.slice(0, 18)).map((h) => {
              const setId = h.id.slice(0, h.id.length - h.localId.length - 1);
              const owned = col.meta[h.id] && cardOwnedAny(col.meta[h.id], col.owned);
              const wanted = Object.keys(col.wants).some((k) => k.startsWith(h.id + '|'));
              return (
                <Pressable key={h.id} style={styles.hit} onPress={() => openHit(h)}>
                  <FallbackImage uris={h.thumbs} style={styles.hitImg} fallback={<View style={[styles.hitImg, { backgroundColor: colors.chip }]} />} />
                  {owned && (
                    <View style={styles.hitOwned}>
                      <Text style={styles.hitOwnedText}>✓</Text>
                    </View>
                  )}
                  <Pressable
                    style={styles.hitHeart}
                    hitSlop={6}
                    onPress={() => toggleWant(h)}
                    accessibilityLabel={wanted ? 'Von der Wunschliste entfernen' : 'Auf die Wunschliste'}
                  >
                    <Text style={[styles.hitHeartText, wanted && { color: colors.accent }]}>{wanted ? '♥' : '♡'}</Text>
                  </Pressable>
                  <Text style={styles.hitName} numberOfLines={1}>
                    {h.name}
                  </Text>
                  <Text style={styles.hitSet} numberOfLines={1}>
                    {setNames.get(setId) ?? setId} · {h.localId}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!showAll && hits.length > 18 && (
            <Pressable onPress={() => setShowAll(true)} style={{ paddingVertical: 8 }}>
              <Text style={styles.more}>Alle {hits.length} Karten zeigen</Text>
            </Pressable>
          )}
          {sections.length > 0 && <Text style={styles.section}>Sets</Text>}
        </View>
      )}
      {error && (
        <Pressable onPress={() => load(true)}>
          <Text style={styles.error}>Laden fehlgeschlagen: {error} – tippen zum Wiederholen</Text>
        </Pressable>
      )}
      {!series && !error && <ActivityIndicator style={{ marginTop: 32 }} color={colors.accent} />}
    </View>
  );

  return (
    <>
    <SectionList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      sections={sections}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load(true).finally(() => setRefreshing(false));
          }}
        />
      }
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => onOpenSet(item)}>
          <View style={styles.logoBox}>
            <FallbackImage
              key={item.id}
              uris={[item.logo && item.logo + '.png', item.logo && toEnglish(item.logo) + '.png', item.logoEn && item.logoEn + '.png']}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.setName}>{item.name}</Text>
            <Text style={styles.meta}>
              {item.total} Karten{item.total !== item.official && item.official ? ` (${item.official} + ${item.total - item.official} Secrets)` : ''}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      )}
    />
    {openCard && <CardSheet card={openCard.card} set={openCard.set} onClose={() => setOpenCard(null)} />}
    </>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  hitHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hits: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hit: { width: 104 },
  hitImg: { width: 104, height: 145, borderRadius: 6 },
  hitOwned: {
    position: 'absolute',
    left: 4,
    top: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.good,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hitOwnedText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  hitHeart: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hitHeartText: { color: '#fff', fontSize: 17, lineHeight: 20 },
  hitName: { fontSize: 12, fontWeight: '600', color: colors.text, marginTop: 3 },
  hitSet: { fontSize: 11, color: colors.muted },
  more: { color: colors.accent, fontWeight: '600', textAlign: 'center' },
  title: { fontSize: 30, fontWeight: '800', color: colors.text, marginBottom: 12 },
  summary: { backgroundColor: colors.accent, borderRadius: 14, padding: 16, marginBottom: 8 },
  summaryLabel: { color: '#FFE4DC', fontSize: 13 },
  summaryValue: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 2 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  mineRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 8 },
  mineValue: { fontWeight: '700', color: colors.text, marginLeft: 12 },
  search: {
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginTop: 20,
    color: colors.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  error: { color: colors.accent, marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 10, marginBottom: 6 },
  logoBox: { width: 72, height: 36, marginRight: 12, justifyContent: 'center' },
  logo: { width: 72, height: 36 },
  setName: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  chevron: { fontSize: 24, color: colors.muted, marginLeft: 8 },
});
