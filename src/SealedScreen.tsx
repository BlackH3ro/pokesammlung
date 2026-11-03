import { ReactNode, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Sealed, sealedValue, useCollection } from './collection';
import { fetchSealedPrice, LANGUAGES, SEALED_KINDS, sealedEbayUrl } from './ebay';
import { useSettings } from './settings';
import { Palette, useColors, useThemedStyles } from './theme';
import { Chip, eur } from './ui';
import { parseEuro } from './WantsScreen';

const langLabel = (id: string) => LANGUAGES.find((l) => l.id === id)?.label ?? id;
const ago = (t: number) => {
  const d = Math.floor((Date.now() - t) / 86400e3);
  return d <= 0 ? 'heute' : d === 1 ? 'gestern' : `vor ${d} Tagen`;
};

// Sealed products (Displays, ETBs, …) with eBay median prices or an own value. `header` is the Slabs/Sealed switch.
export default function SealedScreen({ header, onOpenSettings }: { header: ReactNode; onOpenSettings: () => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const col = useCollection();
  const { settings } = useSettings();
  const hasKeys = !!(settings.ebayClientId && settings.ebayClientSecret);
  const [editing, setEditing] = useState<Sealed | 'new' | null>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refresh = async (item: Sealed) => {
    setLoading((l) => ({ ...l, [item.id]: true }));
    setErrors((e) => ({ ...e, [item.id]: '' }));
    try {
      col.saveSealed({ ...item, price: await fetchSealedPrice(item, settings) });
    } catch (e: any) {
      setErrors((x) => ({ ...x, [item.id]: e?.message ?? String(e) }));
    } finally {
      setLoading((l) => ({ ...l, [item.id]: false }));
    }
  };

  const total = col.sealed.reduce((s, x) => s + sealedValue(x), 0);
  const count = col.sealed.reduce((s, x) => s + x.count, 0);

  const top = (
    <View>
      {header}
      <View style={styles.summary}>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryLabel}>Wert Sealed</Text>
          <Text style={styles.summaryValue}>{eur(total)}</Text>
        </View>
        <View>
          <Text style={styles.summaryLabel}>Produkte</Text>
          <Text style={styles.summaryCount}>{count}</Text>
        </View>
      </View>
      {!hasKeys && (
        <Pressable onPress={onOpenSettings} style={styles.notice}>
          <Text style={styles.noticeText}>Für automatische Preise die kostenlosen eBay-Schlüssel eintragen – oder eigenen Wert angeben ›</Text>
        </Pressable>
      )}
      <View style={styles.actions}>
        <Pressable style={[styles.btn, { flex: 1 }]} onPress={() => setEditing('new')}>
          <Text style={styles.btnText}>+ Produkt hinzufügen</Text>
        </Pressable>
        {hasKeys && col.sealed.length > 0 && (
          <Pressable
            style={[styles.btn, styles.btnLight]}
            onPress={async () => {
              for (const x of col.sealed) await refresh(x);
            }}
          >
            <Text style={[styles.btnText, { color: colors.text }]}>Preise ↻</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <>
      <FlatList
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, maxWidth: 800, width: '100%', alignSelf: 'center' }}
        data={col.sealed}
        keyExtractor={(x) => x.id}
        ListHeaderComponent={top}
        ListEmptyComponent={<Text style={styles.empty}>Noch keine Sealed-Produkte – z. B. Displays, Top-Trainer-Boxen (auch Pokémon Center) oder Tins.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => setEditing(item)}>
            <View style={styles.kindBox}>
              <Text style={styles.kindText} numberOfLines={2}>
                {item.kind}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={2}>
                {item.count > 1 ? `${item.count}× ` : ''}
                {item.name}
              </Text>
              <Text style={styles.meta}>
                {langLabel(item.language)}
                {item.manualValue != null ? ' · eigener Wert' : item.price ? ` · eBay, ${ago(item.price.at)}` : ''}
              </Text>
              {!!errors[item.id] && <Text style={styles.error}>{errors[item.id]}</Text>}
            </View>
            {loading[item.id] ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.value}>{eur(sealedValue(item))}</Text>}
          </Pressable>
        )}
      />
      {editing && (
        <SealedSheet
          item={editing === 'new' ? null : editing}
          canFetch={hasKeys}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            col.saveSealed(item);
            setEditing(null);
            if (hasKeys && item.manualValue == null && !item.price) refresh(item);
          }}
          onRefresh={(item) => {
            col.saveSealed(item);
            setEditing(null);
            refresh(item);
          }}
          onDelete={(id) => {
            col.removeSealed(id);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function SealedSheet(props: {
  item: Sealed | null;
  canFetch: boolean;
  onClose: () => void;
  onSave: (item: Sealed) => void;
  onRefresh: (item: Sealed) => void;
  onDelete: (id: string) => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const it = props.item;
  const [name, setName] = useState(it?.name ?? '');
  const [kind, setKind] = useState(it?.kind ?? 'Display');
  const [language, setLanguage] = useState(it?.language ?? 'de');
  const [count, setCount] = useState(it?.count ?? 1);
  const [manual, setManual] = useState(it?.manualValue != null ? String(it.manualValue).replace('.', ',') : '');
  const [confirm, setConfirm] = useState(false);

  const build = (): Sealed => {
    const same = it && it.name === name.trim() && it.kind === kind && it.language === language;
    return {
      id: it?.id ?? String(Date.now()),
      name: name.trim(),
      kind,
      language,
      count,
      manualValue: parseEuro(manual),
      price: same ? it?.price : undefined, // product changed → old price no longer applies
      addedAt: it?.addedAt ?? Date.now(),
    };
  };
  const valid = name.trim().length >= 3;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View style={styles.sheet}>
        <View style={styles.top}>
          <Pressable onPress={props.onClose} hitSlop={10}>
            <Text style={styles.done}>Abbrechen</Text>
          </Pressable>
          <Text style={[styles.sheetTitle, { textAlign: 'center' }]}>{it ? 'Produkt' : 'Produkt hinzufügen'}</Text>
          <Pressable disabled={!valid} onPress={() => props.onSave(build())} hitSlop={10}>
            <Text style={[styles.done, !valid && { opacity: 0.3 }]}>Sichern</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <View style={styles.inner}>
            <Text style={styles.h}>Produkt</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="z. B. 30 Jahre Elite-Trainer-Box"
              placeholderTextColor={colors.muted}
            />
            <Text style={styles.h}>Art</Text>
            <View style={styles.wrap}>
              {SEALED_KINDS.map((k) => (
                <Chip key={k} label={k} active={kind === k} onPress={() => setKind(k)} />
              ))}
            </View>
            <Text style={styles.h}>Sprache</Text>
            <View style={styles.wrap}>
              {LANGUAGES.map((l) => (
                <Chip key={l.id} label={l.label} active={language === l.id} onPress={() => setLanguage(l.id)} />
              ))}
            </View>
            <Text style={styles.h}>Anzahl</Text>
            <View style={styles.stepRow}>
              <Pressable style={styles.step} onPress={() => setCount((c) => Math.max(1, c - 1))}>
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.countText}>{count}</Text>
              <Pressable style={styles.step} onPress={() => setCount((c) => c + 1)}>
                <Text style={styles.stepText}>+</Text>
              </Pressable>
            </View>
            <Text style={styles.h}>Eigener Wert pro Stück (optional)</Text>
            <TextInput
              style={styles.input}
              value={manual}
              onChangeText={setManual}
              keyboardType="decimal-pad"
              placeholder="leer = eBay-Preis verwenden"
              placeholderTextColor={colors.muted}
            />
            {it?.price && (
              <Text style={styles.note}>
                eBay: {eur(it.price.value)} pro Stück (Median aus {it.price.n} Angeboten, {ago(it.price.at)}){'\n'}Suche: {it.price.query}
              </Text>
            )}

            {it && props.canFetch && (
              <Pressable style={[styles.btn, styles.wide]} onPress={() => props.onRefresh(build())}>
                <Text style={styles.btnText}>eBay-Preis aktualisieren</Text>
              </Pressable>
            )}
            {valid && (
              <Pressable style={[styles.btn, styles.btnLight, styles.wide]} onPress={() => Linking.openURL(sealedEbayUrl({ name, kind, language }))}>
                <Text style={[styles.btnText, { color: colors.text }]}>Auf eBay ansehen</Text>
              </Pressable>
            )}
            {valid && (
              <Pressable
                style={[styles.btn, styles.btnLight, styles.wide]}
                onPress={() =>
                  Linking.openURL('https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=' + encodeURIComponent(name))
                }
              >
                <Text style={[styles.btnText, { color: colors.text }]}>Auf Cardmarket suchen</Text>
              </Pressable>
            )}
            {it && (
              <Pressable
                style={[styles.btn, styles.wide, { backgroundColor: confirm ? colors.accent : colors.chip }]}
                onPress={() => (confirm ? props.onDelete(it.id) : setConfirm(true))}
              >
                <Text style={[styles.btnText, { color: confirm ? '#fff' : colors.accent }]}>{confirm ? 'Wirklich löschen?' : 'Löschen'}</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    summary: { flexDirection: 'row', backgroundColor: colors.hero, borderRadius: 14, padding: 16, alignItems: 'flex-end' },
    summaryLabel: { color: '#C9CDD5', fontSize: 13 },
    summaryValue: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 2 },
    summaryCount: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 2, textAlign: 'right' },
    notice: { backgroundColor: colors.warnBg, borderRadius: 10, padding: 12, marginTop: 12 },
    noticeText: { color: colors.warnText, fontSize: 13, fontWeight: '500' },
    actions: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 12 },
    btn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' },
    btnLight: { backgroundColor: colors.chip },
    btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    wide: { marginTop: 10 },
    empty: { color: colors.muted, textAlign: 'center', marginTop: 16, lineHeight: 20 },
    row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 10, marginBottom: 6, gap: 10 },
    kindBox: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center', padding: 4 },
    kindText: { fontSize: 10, fontWeight: '700', color: colors.text, textAlign: 'center' },
    name: { fontSize: 15, fontWeight: '600', color: colors.text },
    meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
    value: { fontSize: 15, fontWeight: '700', color: colors.text },
    error: { color: colors.accent, fontSize: 12, marginTop: 4 },
    sheet: { flex: 1, backgroundColor: colors.bg },
    top: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      gap: 12,
      backgroundColor: colors.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    sheetTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
    done: { fontSize: 16, color: colors.accent, fontWeight: '600' },
    inner: { maxWidth: 560, width: '100%', alignSelf: 'center' },
    h: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 16, marginBottom: 8 },
    input: {
      backgroundColor: colors.card,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.text,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    step: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center' },
    stepText: { fontSize: 20, color: colors.text, fontWeight: '600' },
    countText: { fontSize: 18, fontWeight: '700', color: colors.text, minWidth: 28, textAlign: 'center' },
    note: { color: colors.muted, fontSize: 12, marginTop: 8, lineHeight: 17 },
  });
