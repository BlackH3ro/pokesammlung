import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  TextInput,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Card, cardImages, loadSet, SetBrief, SetDetail } from './api';
import { shareText, stamp, toCsv } from './backup';
import CardSheet from './CardSheet';
import { rarityInfo } from './rarity';
import { cardComplete, cardOwnedAny, Mode, setStats, slotKey, useCollection } from './collection';
import { Chip, eur, FallbackImage, naturalCompare, Progress } from './ui';
import { Palette, useColors, useThemedStyles } from './theme';

type Sort = 'number' | 'priceDesc' | 'priceAsc' | 'rarity' | 'name';
type Filter = 'all' | 'missing' | 'owned';

const maxPrice = (c: Card) => Math.max(0, ...c.variants.map((v) => v.price ?? 0));

export default function SetScreen({ brief }: { brief: SetBrief }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const col = useCollection();
  const [set, setSet] = useState<SetDetail | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<Sort>('number');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Card | null>(null);
  const { width } = useWindowDimensions();

  const mode: Mode = col.mode[brief.id] ?? 'master';
  const columns = width > 700 ? 5 : 3;
  const tile = (Math.min(width, 1000) - 16 * 2 - 8 * (columns - 1)) / columns;

  const load = (force = false) => {
    return loadSet(brief.id, force, (d, t) => setProgress([d, t]))
      .then((s) => {
        setError(null);
        setSet(s);
        // Keep the "Sammlung" tab's card details (and prices) fresh for cards you own here.
        const owned = s.cards.filter((c) => cardOwnedAny(c, col.owned));
        if (owned.length) col.remember(owned.map((c) => ({ ...c, setId: s.id, setName: s.name })));
      })
      .catch((e) => setError(String(e.message ?? e)));
  };

  useEffect(() => {
    load();
  }, [brief.id]);

  const stats = set ? setStats(set, col, mode) : null;

  const cards = useMemo(() => {
    if (!set) return [];
    let list = set.cards.slice();
    if (filter === 'missing') list = list.filter((c) => !col.excluded[c.id] && !cardComplete(c, col.owned, mode));
    if (filter === 'owned') list = list.filter((c) => cardOwnedAny(c, col.owned));
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((c) => c.name.toLowerCase().includes(needle) || c.localId.toLowerCase().replace(/^0+/, '').startsWith(needle.replace(/^0+/, '')));
    const cmp: Record<Sort, (a: Card, b: Card) => number> = {
      number: (a, b) => naturalCompare(a.localId, b.localId),
      priceDesc: (a, b) => maxPrice(b) - maxPrice(a),
      priceAsc: (a, b) => maxPrice(a) - maxPrice(b),
      name: (a, b) => naturalCompare(a.name, b.name),
      rarity: (a, b) => rarityInfo(b.rarity).rank - rarityInfo(a.rarity).rank || naturalCompare(a.localId, b.localId),
    };
    return list.sort(cmp[sort]);
  }, [set, sort, filter, q, col.owned, col.excluded, mode]);

  if (!set) {
    return (
      <View style={styles.center}>
        {error ? (
          <Pressable onPress={() => load(true)}>
            <Text style={styles.error}>Laden fehlgeschlagen: {error}{'\n'}Tippen zum Wiederholen</Text>
          </Pressable>
        ) : (
          <>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loading}>
              Lade Karten und Preise{progress[1] ? ` … ${progress[0]} / ${progress[1]}` : ' …'}
            </Text>
          </>
        )}
      </View>
    );
  }

  // What's still missing for this set (respecting master/base mode and excluded cards).
  const missingSlots = set
    ? set.cards.flatMap((c) => {
        if (col.excluded[c.id]) return [];
        if (mode === 'master') return c.variants.filter((v) => !col.owned[slotKey(c.id, v.key)]).map((v) => ({ card: c, variantKey: v.key }));
        if (cardOwnedAny(c, col.owned)) return [];
        const cheapest = c.variants.slice().sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];
        return [{ card: c, variantKey: cheapest.key }];
      })
    : [];
  // Shopping list of what's missing, sorted by number – as readable text or as a CSV for Excel.
  const shareMissing = (kind: 'text' | 'csv') => {
    const rows = missingSlots
      .map(({ card, variantKey }) => {
        const v = card.variants.find((x) => x.key === variantKey)!;
        return { card, v };
      })
      .sort((a, b) => naturalCompare(a.card.localId, b.card.localId));
    const total = rows.reduce((sum, r) => sum + (r.v.price ?? 0), 0);
    const safe = set.name.replace(/[^\w\d-]+/g, '_');
    if (kind === 'csv') {
      const csv = toCsv([
        ['Nr.', 'Name', 'Variante', 'Seltenheit', 'Cardmarket-Trend (EUR)'],
        ...rows.map((r) => [r.card.localId, r.card.name, r.v.label, r.card.rarity, r.v.price != null ? r.v.price.toFixed(2).replace('.', ',') : '']),
      ]);
      return shareText(`fehlliste-${safe}-${stamp()}.csv`, csv, 'text/csv').catch(() => {});
    }
    const lines = rows.map((r) => `${r.card.localId} ${r.card.name} – ${r.v.label}${r.v.price != null ? ` (${eur(r.v.price)})` : ''}`);
    const head = `Fehlliste ${set.name} (${mode === 'master' ? 'Masterset' : 'Grundset'})`;
    const text = [head, `${rows.length} Karten, ca. ${eur(total)}`, '', ...lines].join('\n');
    return shareText(`fehlliste-${safe}-${stamp()}.txt`, text, 'text/plain').catch(() => {});
  };

  const wantedCount = missingSlots.filter((m) => col.wants[slotKey(m.card.id, m.variantKey)]).length;

  const header = (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.title}>{set.name}</Text>
      {stats && (
        <View style={styles.statsBox}>
          <View style={styles.statsRow}>
            <Text style={styles.big}>
              {stats.have} / {stats.need}
            </Text>
            <Text style={styles.pct}>{stats.need ? Math.floor((stats.have / stats.need) * 100) : 0}%</Text>
          </View>
          <Progress have={stats.have} need={stats.need} />
          <View style={[styles.statsRow, { marginTop: 10 }]}>
            <Stat label="Mein Wert" value={eur(stats.ownedValue)} />
            <Stat label="Fehlt noch" value={eur(stats.missingValue)} />
            <Stat label={mode === 'master' ? 'Masterset' : 'Grundset'} value={eur(stats.setValue)} />
          </View>
        </View>
      )}
      <View style={styles.chips}>
        <Chip label="Masterset" active={mode === 'master'} onPress={() => col.setMode(set.id, 'master')} />
        <Chip label="Grundset" active={mode === 'base'} onPress={() => col.setMode(set.id, 'base')} />
      </View>
      <Text style={styles.hint}>
        {mode === 'master'
          ? 'Masterset: jede Variante (Normal, Reverse Holo, Stempel …) zählt einzeln.'
          : 'Grundset: jede Karte zählt einmal, egal welche Variante.'}{' '}
        Ausgeschlossene Karten zählen nicht mit.
        {'\n'}„+“ = nächste fehlende Variante hinzufügen · Bild antippen = Details.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        <Chip label="Nr." active={sort === 'number'} onPress={() => setSort('number')} />
        <Chip label="Preis ↓" active={sort === 'priceDesc'} onPress={() => setSort('priceDesc')} />
        <Chip label="Preis ↑" active={sort === 'priceAsc'} onPress={() => setSort('priceAsc')} />
        <Chip label="Seltenheit" active={sort === 'rarity'} onPress={() => setSort('rarity')} />
        <Chip label="Name" active={sort === 'name'} onPress={() => setSort('name')} />
      </ScrollView>
      <View style={styles.chips}>
        <Chip label="Alle" active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="Fehlen" active={filter === 'missing'} onPress={() => setFilter('missing')} />
        <Chip label="Habe ich" active={filter === 'owned'} onPress={() => setFilter('owned')} />
      </View>
      <TextInput
        style={styles.search}
        placeholder="In diesem Set suchen (Name oder Nummer)"
        placeholderTextColor={colors.muted}
        value={q}
        onChangeText={setQ}
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      {missingSlots.length > 0 && (
        <Pressable style={styles.wantAll} onPress={() => col.setWants(set, missingSlots)}>
          <Text style={styles.wantAllText}>
            {wantedCount >= missingSlots.length
              ? `♥ Alle ${missingSlots.length} fehlenden stehen auf der Wunschliste`
              : `♡ ${missingSlots.length - wantedCount} fehlende auf die Wunschliste`}
          </Text>
        </Pressable>
      )}
      {missingSlots.length > 0 && (
        <View style={styles.shareRow}>
          <Pressable style={[styles.wantAll, { flex: 1 }]} onPress={() => shareMissing('text')}>
            <Text style={styles.wantAllText}>Fehlliste teilen</Text>
          </Pressable>
          <Pressable style={[styles.wantAll, { flex: 1 }]} onPress={() => shareMissing('csv')}>
            <Text style={styles.wantAllText}>Fehlliste als CSV</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <>
      <FlatList
        key={columns}
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: 1000, width: '100%', alignSelf: 'center' }}
        data={cards}
        numColumns={columns}
        columnWrapperStyle={{ gap: 8 }}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={styles.hint}>Keine Karten für diesen Filter.</Text>}
        initialNumToRender={18}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(true).finally(() => setRefreshing(false));
            }}
          />
        }
        renderItem={({ item }) => (
          <CardTile
            card={item}
            width={tile}
            complete={cardComplete(item, col.owned, mode)}
            onOpen={() => setOpen(item)}
            onQuickAdd={() => {
              // Master: next missing variant. Base: any variant counts, so only add if none is owned yet.
              const missing = item.variants.find((v) => !col.owned[slotKey(item.id, v.key)]);
              const needed = mode === 'master' ? missing : cardOwnedAny(item, col.owned) ? undefined : item.variants[0];
              if (!needed) return setOpen(item);
              col.setCount(set, item, needed.key, 1);
              if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }}
            onToggle={(vKey) => {
              const n = col.owned[slotKey(item.id, vKey)] ?? 0;
              col.setCount(set, item, vKey, n > 0 ? 0 : 1);
            }}
          />
        )}
      />
      <CardSheet card={open} set={set} onClose={() => setOpen(null)} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function CardTile(props: {
  card: Card;
  width: number;
  complete: boolean;
  onOpen: () => void;
  onQuickAdd: () => void;
  onToggle: (v: string) => void;
}) {
  const { card, width, complete, onOpen, onQuickAdd, onToggle } = props;
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const col = useCollection();
  const excluded = !!col.excluded[card.id];
  const any = cardOwnedAny(card, col.owned);
  return (
    <View style={[styles.tile, { width }, excluded && { opacity: 0.4 }]}>
      <Pressable onPress={onOpen}>
        <FallbackImage
          key={card.id}
          uris={cardImages(card)}
          style={[styles.img, { width: width - 8, height: (width - 8) * 1.395 }, !any && styles.notOwned]}
          fallback={
            <View style={[styles.img, styles.noImg, { width: width - 8, height: (width - 8) * 1.395 }]}>
              <Text style={styles.meta}>{card.name}</Text>
            </View>
          }
        />
        {complete && (
          <View style={styles.check} pointerEvents="none">
            <Text style={styles.checkText}>✓</Text>
          </View>
        )}
        {card.variants.some((v) => col.wants[slotKey(card.id, v.key)]) && (
          <View style={styles.wantBadge} pointerEvents="none">
            <Text style={styles.wantBadgeText}>♥</Text>
          </View>
        )}
      </Pressable>
      <Text style={styles.cardName} numberOfLines={1}>
        {card.localId} · {card.name}
      </Text>
      <View style={styles.bottomRow}>
      <View style={[styles.variants, { flex: 1 }]}>
        {card.variants.map((v) => {
          const owned = (col.owned[slotKey(card.id, v.key)] ?? 0) > 0;
          return (
            <Pressable key={v.key} onPress={() => onToggle(v.key)} hitSlop={4} style={[styles.vPill, owned && styles.vPillOn]}>
              <Text style={[styles.vText, owned && styles.vTextOn]} numberOfLines={1}>
                {short(v.label)} {v.price != null ? eur(v.price) : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
        <Pressable
          onPress={onQuickAdd}
          hitSlop={6}
          style={[styles.addBtn, complete && { backgroundColor: colors.good }]}
          accessibilityLabel={complete ? 'Vollständig, Details öffnen' : 'Nächste fehlende Variante hinzufügen'}
        >
          <Text style={styles.addText}>{complete ? '✓' : '+'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function short(label: string) {
  if (label.startsWith('Reverse')) return 'RH' + (label.includes('(') ? '*' : '');
  if (label.startsWith('Normal')) return 'N' + (label.includes('(') ? '*' : '');
  if (label.startsWith('Holo')) return 'H' + (label.includes('(') ? '*' : '');
  return label.slice(0, 3);
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  wantBadge: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wantBadgeText: { color: colors.accent, fontSize: 14 },
  search: {
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    color: colors.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    marginBottom: 8,
  },
  shareRow: { flexDirection: 'row', gap: 8 },
  wantAll: { backgroundColor: colors.chip, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginBottom: 8 },
  wantAllText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 },
  loading: { marginTop: 12, color: colors.muted },
  error: { color: colors.accent, textAlign: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: 12 },
  statsBox: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 12 },
  statsRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 },
  big: { fontSize: 22, fontWeight: '800', color: colors.text },
  pct: { fontSize: 15, fontWeight: '600', color: colors.muted },
  statLabel: { fontSize: 12, color: colors.muted },
  statValue: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 2 },
  chips: { flexDirection: 'row', marginBottom: 8 },
  hint: { fontSize: 12, color: colors.muted, marginBottom: 10 },
  tile: { backgroundColor: colors.card, borderRadius: 10, padding: 4, marginBottom: 8 },
  img: { borderRadius: 6 },
  notOwned: { opacity: 0.45 },
  check: {
    position: 'absolute',
    left: 6,
    top: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.good,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  bottomRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  addBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  addText: { color: '#fff', fontWeight: '800', fontSize: 16, lineHeight: 18 },
  noImg: { backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center', padding: 4 },
  meta: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  cardName: { fontSize: 11, color: colors.text, marginTop: 4, fontWeight: '500' },
  variants: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 4 },
  vPill: { paddingHorizontal: 5, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.chip, maxWidth: '100%' },
  vPillOn: { backgroundColor: colors.good },
  vText: { fontSize: 10, color: colors.text },
  vTextOn: { color: '#fff', fontWeight: '600' },
});
