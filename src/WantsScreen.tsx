import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { cardImages, SetBrief } from './api';
import { isAlarm, useCollection, Want } from './collection';
import { refreshPrices } from './refresh';
import { shareText, stamp } from './backup';
import { Palette, useColors, useThemedStyles } from './theme';
import { Chip, eur, FallbackImage, naturalCompare, Trend } from './ui';

type Sort = 'alarm' | 'priceDesc' | 'priceAsc' | 'set';

export const parseEuro = (t: string) => {
  const n = parseFloat(t.replace(/[^\d,.]/g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
};

const ago = (t?: number) => {
  if (!t) return 'nie';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 60) return m <= 1 ? 'gerade eben' : `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  return h < 24 ? `vor ${h} Std.` : `vor ${Math.floor(h / 24)} Tagen`;
};

export default function WantsScreen({ onOpenSet }: { onOpenSet: (s: SetBrief) => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const col = useCollection();
  const [sort, setSort] = useState<Sort>('alarm');
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const wants = Object.values(col.wants);
  const alarms = wants.filter(isAlarm);
  const total = wants.reduce((s, w) => s + (w.price ?? 0), 0);

  const list = useMemo(() => {
    const cmp: Record<Sort, (a: Want, b: Want) => number> = {
      alarm: (a, b) => Number(isAlarm(b)) - Number(isAlarm(a)) || (b.price ?? 0) - (a.price ?? 0),
      priceDesc: (a, b) => (b.price ?? 0) - (a.price ?? 0),
      priceAsc: (a, b) => (a.price ?? 0) - (b.price ?? 0),
      set: (a, b) => naturalCompare(a.card.setName, b.card.setName) || naturalCompare(a.card.localId, b.card.localId),
    };
    return Object.values(col.wants).sort(cmp[sort]);
  }, [col.wants, sort]);

  const check = async () => {
    setChecking(true);
    try {
      const { wantPrices } = await refreshPrices([], col.meta, col.wants);
      col.applyWantPrices(wantPrices);
    } finally {
      setChecking(false);
    }
  };

  const current = open ? col.wants[open] : null;

  const shareList = () => {
    const rows = list.map((w) => {
      const label = w.card.variants.find((v) => v.key === w.vKey)?.label ?? w.vKey;
      return `${w.card.name} (${w.card.setName} ${w.card.localId}, ${label})${w.price != null ? ` – ${eur(w.price)}` : ''}`;
    });
    const text = [`Meine Wunschliste – ${wants.length} Karten, ca. ${eur(total)}`, '', ...rows].join('\n');
    shareText(`wunschliste-${stamp()}.txt`, text, 'text/plain').catch(() => {});
  };

  const header = (
    <View>
      <Text style={styles.title}>Wunschliste</Text>
      <View style={styles.summary}>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryLabel}>Kostet zusammen</Text>
          <Text style={styles.summaryValue}>{eur(total)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.summaryLabel}>{wants.length} Karten</Text>
          <Text style={styles.summaryAlarm}>{alarms.length} im Wunschpreis</Text>
        </View>
      </View>
      <View style={styles.checkRow}>
        <Text style={styles.meta}>Preise geprüft: {ago(col.wantsCheckedAt)}</Text>
        {wants.length > 0 && (
          <Pressable onPress={shareList} hitSlop={8}>
            <Text style={styles.link}>Teilen</Text>
          </Pressable>
        )}
        <Pressable onPress={check} disabled={checking || !wants.length} hitSlop={8}>
          {checking ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.link}>Jetzt prüfen ↻</Text>}
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
        <Chip label="Alarm zuerst" active={sort === 'alarm'} onPress={() => setSort('alarm')} />
        <Chip label="Preis ↓" active={sort === 'priceDesc'} onPress={() => setSort('priceDesc')} />
        <Chip label="Preis ↑" active={sort === 'priceAsc'} onPress={() => setSort('priceAsc')} />
        <Chip label="Set" active={sort === 'set'} onPress={() => setSort('set')} />
      </ScrollView>
    </View>
  );

  return (
    <>
      <FlatList
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, maxWidth: 800, width: '100%', alignSelf: 'center' }}
        data={list}
        keyExtractor={(w) => w.key}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Noch keine Wunschkarten. Tippe in einer Karte auf ♡ oder nutze im Set „Fehlende auf die Wunschliste“.
          </Text>
        }
        renderItem={({ item }) => {
          const hit = isAlarm(item);
          const label = item.card.variants.find((v) => v.key === item.vKey)?.label ?? item.vKey;
          return (
            <Pressable style={[styles.row, hit && styles.hitRow]} onPress={() => setOpen(item.key)}>
              <FallbackImage key={item.key} uris={cardImages(item.card)} style={styles.thumb} fallback={<View style={styles.thumb} />} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.card.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.card.setName} · {item.card.localId} · {label}
                </Text>
                <Text style={[styles.meta, hit && { color: colors.good, fontWeight: '700' }]}>
                  {item.target != null ? `${hit ? 'Preisalarm! ' : ''}Wunschpreis ${eur(item.target)}` : 'kein Wunschpreis'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.value, hit && { color: colors.good }]}>{eur(item.price)}</Text>
                <Trend price={item.price} avg30={item.card.variants.find((v) => v.key === item.vKey)?.avg30} />
              </View>
            </Pressable>
          );
        }}
      />
      {current && <WantSheet want={current} onClose={() => setOpen(null)} onOpenSet={onOpenSet} />}
    </>
  );
}

function WantSheet({ want, onClose, onOpenSet }: { want: Want; onClose: () => void; onOpenSet: (s: SetBrief) => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const col = useCollection();
  const [target, setTarget] = useState(want.target != null ? String(want.target).replace('.', ',') : '');
  const set = { id: want.card.setId, name: want.card.setName };
  const label = want.card.variants.find((v) => v.key === want.vKey)?.label ?? want.vKey;

  const save = () => {
    col.setWant(set, want.card, want.vKey, parseEuro(target));
    onClose();
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={save}>
      <View style={styles.sheet}>
        <View style={styles.top}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {want.card.name}
          </Text>
          <Pressable onPress={save} hitSlop={10}>
            <Text style={styles.done}>Fertig</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
          <FallbackImage uris={cardImages(want.card, 'high')} style={styles.bigImg} resizeMode="contain" />
          <Text style={styles.metaCenter}>
            {want.card.setName} · {want.card.localId} · {label}
          </Text>
          <View style={styles.box}>
            <Text style={styles.metaCenter}>Aktueller Cardmarket-Trend</Text>
            <Text style={styles.priceBig}>{eur(want.price)}</Text>
            <Text style={[styles.label, { marginTop: 12 }]}>Wunschpreis (Alarm, wenn Preis darunter fällt)</Text>
            <TextInput
              style={styles.input}
              value={target}
              onChangeText={setTarget}
              keyboardType="decimal-pad"
              placeholder="z. B. 12,50"
              placeholderTextColor={colors.muted}
            />
          </View>
          <Pressable
            style={[styles.btn, styles.wide]}
            onPress={() =>
              Linking.openURL(
                'https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=' + encodeURIComponent(want.card.name),
              )
            }
          >
            <Text style={styles.btnText}>Auf Cardmarket suchen</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnLight, styles.wide]}
            onPress={() => {
              col.addOne(set, want.card, want.vKey); // also removes it from the wishlist
              onClose();
            }}
          >
            <Text style={[styles.btnText, { color: colors.text }]}>Gekauft – in Sammlung übernehmen</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnLight, styles.wide]}
            onPress={() => {
              onClose();
              onOpenSet({ id: want.card.setId, name: want.card.setName, official: 0, total: 0 });
            }}
          >
            <Text style={[styles.btnText, { color: colors.text }]}>Set öffnen</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnLight, styles.wide]}
            onPress={() => {
              col.removeWant(want.key);
              onClose();
            }}
          >
            <Text style={[styles.btnText, { color: colors.accent }]}>Von der Wunschliste entfernen</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    title: { fontSize: 30, fontWeight: '800', color: colors.text, marginBottom: 12 },
    summary: { flexDirection: 'row', backgroundColor: colors.hero, borderRadius: 14, padding: 16, alignItems: 'flex-end' },
    summaryLabel: { color: '#C9CDD5', fontSize: 13 },
    summaryValue: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 2 },
    summaryAlarm: { color: '#4ADE80', fontSize: 15, fontWeight: '700', marginTop: 4 },
    checkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 12 },
    link: { color: colors.accent, fontWeight: '600' },
    empty: { color: colors.muted, textAlign: 'center', marginTop: 16, lineHeight: 20 },
    row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 8, marginBottom: 6, gap: 10 },
    hitRow: { borderWidth: 1.5, borderColor: colors.good },
    thumb: { width: 44, height: 61, borderRadius: 4, backgroundColor: colors.chip },
    name: { fontSize: 15, fontWeight: '600', color: colors.text },
    meta: { fontSize: 12, color: colors.muted, marginTop: 1 },
    metaCenter: { fontSize: 12, color: colors.muted, marginTop: 1, textAlign: 'center' },
    value: { fontSize: 15, fontWeight: '700', color: colors.text },
    sheet: { flex: 1, backgroundColor: colors.bg },
    top: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      backgroundColor: colors.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    sheetTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
    done: { fontSize: 16, color: colors.accent, fontWeight: '600' },
    bigImg: { width: 240, height: 334, borderRadius: 12, marginBottom: 10 },
    box: { backgroundColor: colors.card, borderRadius: 12, padding: 14, alignSelf: 'center', marginTop: 12, maxWidth: 520, width: '100%' },
    priceBig: { fontSize: 28, fontWeight: '800', color: colors.text, textAlign: 'center' },
    label: { fontSize: 13, color: colors.text, fontWeight: '500', marginBottom: 6 },
    input: {
      backgroundColor: colors.bg,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: colors.text,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    btn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' },
    btnLight: { backgroundColor: colors.chip },
    btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    wide: { alignSelf: 'center', marginTop: 10, maxWidth: 520, width: '100%' },
  });
