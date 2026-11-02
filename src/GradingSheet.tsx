import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, fetchCardRaw } from './api';
import type { Slab } from './collection';
import { fetchSlabPrice } from './ebay';
import { useSettings } from './settings';
import { Palette, useColors, useThemedStyles } from './theme';
import { Chip, eur } from './ui';
import { parseEuro } from './WantsScreen';

// Rough per-card fees incl. return shipping in EUR. Only a starting point – the user can edit them.
const COMPANIES: { id: string; fee: number }[] = [
  { id: 'PSA', fee: 30 },
  { id: 'CGC', fee: 20 },
  { id: 'BGS', fee: 30 },
  { id: 'TAG', fee: 25 },
  { id: 'ACE', fee: 15 },
];
const LANGS = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'Englisch' },
];

const fmt = (n: number | null) => (n == null ? '' : String(n).replace('.', ','));

export default function GradingSheet({ card, onClose }: { card: Card; onClose: () => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { settings } = useSettings();
  const hasKeys = !!(settings.ebayClientId && settings.ebayClientSecret);
  const priced = card.variants.filter((v) => v.price != null);
  const [vKey, setVKey] = useState((priced[0] ?? card.variants[0]).key);
  const [company, setCompany] = useState('PSA');
  const [language, setLanguage] = useState('de');
  const [fee, setFee] = useState('30');
  const [shipping, setShipping] = useState('10');
  const [p10, setP10] = useState('');
  const [p9, setP9] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const raw = card.variants.find((v) => v.key === vKey)?.price ?? null;

  const loadPrices = async () => {
    setLoading(true);
    setError('');
    const en = await fetchCardRaw(card.id, 'en');
    const base: Slab = {
      id: 'calc',
      name: card.name,
      nameEn: en?.name,
      setName: '',
      number: card.localId,
      language,
      company,
      grade: '10',
      addedAt: 0,
    };
    const [r10, r9] = await Promise.allSettled([fetchSlabPrice(base, settings), fetchSlabPrice({ ...base, grade: '9' }, settings)]);
    setP10(r10.status === 'fulfilled' ? fmt(r10.value.value) : '');
    setP9(r9.status === 'fulfilled' ? fmt(r9.value.value) : '');
    if (r10.status === 'rejected' && r9.status === 'rejected') setError(String((r10.reason as Error)?.message ?? r10.reason));
    setLoading(false);
  };

  useEffect(() => {
    if (hasKeys) loadPrices();
  }, [company, language]);

  const costs = (raw ?? 0) + (parseEuro(fee) ?? 0) + (parseEuro(shipping) ?? 0);
  const result = (graded: number | null) => (graded == null ? null : graded - costs);

  const profit10 = result(parseEuro(p10));
  const verdict =
    profit10 == null
      ? 'Trag die Slab-Preise ein (oder hinterlege eBay-Schlüssel), dann rechnet die App.'
      : profit10 > costs * 0.3
        ? 'Lohnt sich, wenn du eine 10 erwartest.'
        : profit10 > 0
          ? 'Knapp: nur mit einer 10 lohnt es sich, und auch dann kaum.'
          : 'Lohnt sich eher nicht – selbst eine 10 deckt die Kosten nicht.';

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={1}>
            Grading-Rechner · {card.name}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.done}>Fertig</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={styles.inner}>
            {card.variants.length > 1 && (
              <>
                <Text style={styles.h}>Variante</Text>
                <View style={styles.chips}>
                  {card.variants.map((v) => (
                    <Chip key={v.key} label={`${v.label} ${eur(v.price)}`} active={vKey === v.key} onPress={() => setVKey(v.key)} />
                  ))}
                </View>
              </>
            )}
            <Text style={styles.h}>Grading-Firma</Text>
            <View style={styles.chips}>
              {COMPANIES.map((c) => (
                <Chip
                  key={c.id}
                  label={c.id}
                  active={company === c.id}
                  onPress={() => {
                    setCompany(c.id);
                    setFee(String(c.fee));
                  }}
                />
              ))}
            </View>
            <Text style={styles.h}>Sprache der Karte</Text>
            <View style={styles.chips}>
              {LANGS.map((l) => (
                <Chip key={l.id} label={l.label} active={language === l.id} onPress={() => setLanguage(l.id)} />
              ))}
            </View>

            <View style={styles.box}>
              <Row label="Rohpreis (Cardmarket-Trend)" value={eur(raw)} styles={styles} />
              <View style={styles.inputRow}>
                <Text style={[styles.rowLabel, { flex: 1 }]}>Grading-Gebühr</Text>
                <TextInput style={[styles.input, styles.small]} value={fee} onChangeText={setFee} keyboardType="decimal-pad" />
              </View>
              <View style={styles.inputRow}>
                <Text style={[styles.rowLabel, { flex: 1 }]}>Versand & Versicherung</Text>
                <TextInput style={[styles.input, styles.small]} value={shipping} onChangeText={setShipping} keyboardType="decimal-pad" />
              </View>
              <Row label="Kosten gesamt" value={eur(costs)} styles={styles} strong />
            </View>

            <View style={styles.headRow}>
              <Text style={styles.h}>Slab-Preise & Gewinn</Text>
              {loading && <ActivityIndicator color={colors.accent} />}
            </View>
            <View style={styles.box}>
              <Outcome label={`${company} 10`} price={p10} onChange={setP10} profit={result(parseEuro(p10))} />
              <Outcome label={`${company} 9`} price={p9} onChange={setP9} profit={result(parseEuro(p9))} />
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
            {!hasKeys && <Text style={styles.note}>Ohne eBay-Schlüssel trägst du die Slab-Preise selbst ein.</Text>}

            <View style={[styles.box, { marginTop: 12 }]}>
              <Text style={styles.verdict}>{verdict}</Text>
            </View>
            <Text style={styles.note}>
              Gebühren sind Schätzwerte – prüf die aktuellen Preise der Grading-Firma. Slab-Preise sind der Median aktueller
              eBay-Angebote, keine garantierten Verkaufspreise.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Outcome(props: { label: string; price: string; onChange: (t: string) => void; profit: number | null }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { profit } = props;
  return (
    <View style={styles.outcome}>
      <Text style={styles.outLabel}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.price}
        onChangeText={props.onChange}
        keyboardType="decimal-pad"
        placeholder="Slab-Preis"
        placeholderTextColor={colors.muted}
      />
      <Text style={[styles.profit, profit != null && { color: profit >= 0 ? colors.good : colors.accent }]}>
        {profit == null ? '–' : (profit >= 0 ? '+' : '') + eur(profit)}
      </Text>
    </View>
  );
}

function Row({ label, value, strong, styles }: { label: string; value: string; strong?: boolean; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.inputRow}>
      <Text style={[styles.rowLabel, { flex: 1 }, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.bg },
    top: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      backgroundColor: colors.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    title: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
    done: { fontSize: 16, color: colors.accent, fontWeight: '600' },
    inner: { maxWidth: 560, width: '100%', alignSelf: 'center' },
    h: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 14, marginBottom: 8 },
    headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 },
    box: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 12, gap: 8 },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowLabel: { fontSize: 14, color: colors.text },
    rowValue: { fontSize: 14, color: colors.text, fontWeight: '600' },
    strong: { fontWeight: '800' },
    input: {
      backgroundColor: colors.bg,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 15,
      color: colors.text,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      flex: 1,
    },
    small: { flex: 0, width: 90, textAlign: 'right' },
    outcome: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    outLabel: { width: 60, fontSize: 14, fontWeight: '700', color: colors.text },
    profit: { width: 100, textAlign: 'right', fontSize: 15, fontWeight: '800', color: colors.muted },
    verdict: { fontSize: 15, fontWeight: '600', color: colors.text, textAlign: 'center' },
    error: { color: colors.accent, fontSize: 12, marginTop: 6 },
    note: { color: colors.muted, fontSize: 12, marginTop: 8, lineHeight: 17 },
  });
