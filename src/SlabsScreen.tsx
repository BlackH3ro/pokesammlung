import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CardHit, cardImages, getCard, searchCards } from './api';
import { Slab, useCollection } from './collection';
import SealedScreen from './SealedScreen';
import ValueChart from './ValueChart';
import { COMPANIES, ebayUrl, fetchSlabPrice, GRADES, LANGUAGES } from './ebay';
import { useSettings } from './settings';
import { Chip, eur, FallbackImage, toEnglish } from './ui';
import { Palette, useColors, useThemedStyles } from './theme';

const langLabel = (id: string) => LANGUAGES.find((l) => l.id === id)?.label ?? id;
const ago = (t: number) => {
  const d = Math.floor((Date.now() - t) / 86400e3);
  return d <= 0 ? 'heute' : d === 1 ? 'gestern' : `vor ${d} Tagen`;
};

export default function SlabsScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const col = useCollection();
  const { settings } = useSettings();
  const [adding, setAdding] = useState(false);
  const [segment, setSegment] = useState<'slabs' | 'sealed'>('slabs');
  const [open, setOpen] = useState<Slab | null>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const hasKeys = !!(settings.ebayClientId && settings.ebayClientSecret);

  const refresh = async (slab: Slab) => {
    setLoading((l) => ({ ...l, [slab.id]: true }));
    setErrors((e) => ({ ...e, [slab.id]: '' }));
    try {
      const price = await fetchSlabPrice(slab, settings);
      col.saveSlab({ ...slab, price });
    } catch (e: any) {
      setErrors((x) => ({ ...x, [slab.id]: e?.message ?? String(e) }));
    } finally {
      setLoading((l) => ({ ...l, [slab.id]: false }));
    }
  };

  const refreshAll = async () => {
    for (const s of col.slabs) await refresh(s);
  };

  const total = col.slabs.reduce((s, x) => s + (x.price?.value ?? 0), 0);
  const current = open ? col.slabs.find((s) => s.id === open.id) ?? null : null;

  const switcher = (
    <View style={styles.segment}>
      {(['slabs', 'sealed'] as const).map((id) => (
        <Pressable key={id} style={[styles.segBtn, segment === id && styles.segActive]} onPress={() => setSegment(id)}>
          <Text style={[styles.segText, segment === id && styles.segTextActive]}>{id === 'slabs' ? 'Slabs' : 'Sealed'}</Text>
        </Pressable>
      ))}
    </View>
  );

  if (segment === 'sealed') return <SealedScreen header={switcher} onOpenSettings={onOpenSettings} />;

  const header = (
    <View>
      {switcher}
      <View style={styles.summary}>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryLabel}>Marktwert (eBay-Angebote)</Text>
          <Text style={styles.summaryValue}>{eur(total)}</Text>
        </View>
        <View>
          <Text style={styles.summaryLabel}>Slabs</Text>
          <Text style={styles.summaryCount}>{col.slabs.length}</Text>
        </View>
      </View>
      {!hasKeys && (
        <Pressable onPress={onOpenSettings} style={styles.notice}>
          <Text style={styles.noticeText}>Für automatische Preise einmal die kostenlosen eBay-Schlüssel eintragen ›</Text>
        </Pressable>
      )}
      <View style={styles.actions}>
        <Pressable style={[styles.btn, { flex: 1 }]} onPress={() => setAdding(true)}>
          <Text style={styles.btnText}>+ Slab hinzufügen</Text>
        </Pressable>
        {hasKeys && col.slabs.length > 0 && (
          <Pressable style={[styles.btn, styles.btnLight]} onPress={refreshAll}>
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
        data={col.slabs}
        keyExtractor={(s) => s.id}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={styles.empty}>Noch keine Slabs eingetragen.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => setOpen(item)}>
            <FallbackImage
              key={item.id}
              uris={[item.image, toEnglish(item.image)]}
              style={styles.thumb}
              fallback={<View style={styles.thumb} />}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {item.setName}
                {item.number ? ` · ${item.number}` : ''} · {langLabel(item.language)}
              </Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {item.company} {item.grade}
                </Text>
              </View>
              {!!errors[item.id] && <Text style={styles.error}>{errors[item.id]}</Text>}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {loading[item.id] ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={styles.value}>{eur(item.price?.value)}</Text>
              )}
              {item.price && <Text style={styles.meta}>{ago(item.price.at)}</Text>}
            </View>
          </Pressable>
        )}
      />
      <AddSlabSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onSave={(slab) => {
          col.saveSlab(slab);
          setAdding(false);
          if (hasKeys) refresh(slab);
        }}
      />
      {current && (
        <SlabSheet
          slab={current}
          loading={!!loading[current.id]}
          error={errors[current.id]}
          canRefresh={hasKeys}
          onRefresh={() => refresh(current)}
          onDelete={() => {
            col.removeSlab(current.id);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function SlabSheet(props: {
  slab: Slab;
  loading: boolean;
  error?: string;
  canRefresh: boolean;
  onRefresh: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { slab } = props;
  const [confirm, setConfirm] = useState(false);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View style={styles.sheet}>
        <View style={styles.top}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {slab.company} {slab.grade} · {slab.name}
          </Text>
          <Pressable onPress={props.onClose} hitSlop={10}>
            <Text style={styles.done}>Fertig</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, alignItems: 'center' }}>
          <FallbackImage uris={[slab.image?.replace('/low.png', '/high.png').replace('.thumb.png', '.png'), slab.image]} style={styles.bigImg} resizeMode="contain" />
          <Text style={styles.metaCenter}>
            {slab.setName}
            {slab.number ? ` · ${slab.number}` : ''} · {langLabel(slab.language)}
            {slab.cert ? ` · Zert. ${slab.cert}` : ''}
          </Text>
          <View style={styles.box}>
            <Text style={styles.priceBig}>{props.loading ? '…' : eur(slab.price?.value)}</Text>
            {slab.price ? (
              <Text style={styles.metaCenter}>
                Median aus {slab.price.n} Angeboten, {ago(slab.price.at)}
                {'\n'}Suche: {slab.price.query}
              </Text>
            ) : (
              <Text style={styles.metaCenter}>Noch kein Preis</Text>
            )}
            {!!props.error && <Text style={styles.error}>{props.error}</Text>}
          </View>
          <View style={styles.wide}>
            <ValueChart
              points={slab.history ?? []}
              title="Preisverlauf"
              emptyText={
                slab.price
                  ? 'Die Kurve wächst ab jetzt mit: Der Preis wird jeden Tag automatisch neu geholt.'
                  : 'Sobald es einen Preis gibt, wird er jeden Tag gespeichert und hier als Kurve gezeigt.'
              }
            />
          </View>
          {props.canRefresh && (
            <Pressable style={[styles.btn, styles.wide]} onPress={props.onRefresh}>
              <Text style={styles.btnText}>Preis aktualisieren</Text>
            </Pressable>
          )}
          <Pressable style={[styles.btn, styles.btnLight, styles.wide]} onPress={() => Linking.openURL(ebayUrl(slab))}>
            <Text style={[styles.btnText, { color: colors.text }]}>Auf eBay ansehen</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.wide, { backgroundColor: confirm ? colors.accent : colors.chip }]} onPress={() => (confirm ? props.onDelete() : setConfirm(true))}>
            <Text style={[styles.btnText, { color: confirm ? '#fff' : colors.accent }]}>{confirm ? 'Wirklich löschen?' : 'Slab löschen'}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

type Picked = { cardId?: string; name: string; nameEn?: string; setName: string; number: string; image?: string };

function AddSlabSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (s: Slab) => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible && <AddSlabForm onClose={onClose} onSave={onSave} />}
    </Modal>
  );
}

function AddSlabForm({ onClose, onSave }: { onClose: () => void; onSave: (s: Slab) => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CardHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [manual, setManual] = useState(false);
  const [company, setCompany] = useState('PSA');
  const [grade, setGrade] = useState('10');
  const [language, setLanguage] = useState('de');
  const [cert, setCert] = useState('');

  const searchable = !manual && q.trim().length >= 3;
  useEffect(() => {
    if (!searchable) return;
    const t = setTimeout(() => {
      setSearching(true);
      searchCards(q)
        .then(setHits)
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(t);
  }, [q, searchable]);

  const pick = async (hit: CardHit) => {
    setPicked({ cardId: hit.id, name: hit.name, setName: '…', number: hit.localId, image: hit.thumbs[0] });
    const res = await getCard(hit.id);
    if (res)
      setPicked({
        cardId: hit.id,
        name: res.card.name,
        nameEn: res.nameEn,
        setName: res.setName,
        number: res.card.localId,
        image: cardImages(res.card)[0],
      });
  };

  const valid = picked && picked.name.trim() && company && grade;

  return (
      <View style={styles.sheet}>
        <View style={styles.top}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.done}>Abbrechen</Text>
          </Pressable>
          <Text style={[styles.sheetTitle, { textAlign: 'center' }]}>Slab hinzufügen</Text>
          <Pressable
            disabled={!valid}
            onPress={() =>
              onSave({
                id: String(Date.now()),
                ...picked!,
                company,
                grade,
                language,
                cert: cert.trim() || undefined,
                addedAt: Date.now(),
              })
            }
            hitSlop={10}
          >
            <Text style={[styles.done, !valid && { opacity: 0.3 }]}>Sichern</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.h}>Karte</Text>
          {picked && !manual ? (
            <Pressable style={styles.row} onPress={() => setPicked(null)}>
              <FallbackImage uris={[picked.image, toEnglish(picked.image)]} style={styles.thumb} fallback={<View style={styles.thumb} />} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{picked.name}</Text>
                <Text style={styles.meta}>
                  {picked.setName} · {picked.number}
                </Text>
              </View>
              <Text style={styles.meta}>ändern</Text>
            </Pressable>
          ) : manual ? (
            <View style={{ gap: 8 }}>
              <TextInput style={styles.input} placeholder="Kartenname (z. B. Glurak)" placeholderTextColor={colors.muted} value={picked?.name ?? ''} onChangeText={(t) => setPicked({ ...(picked ?? { setName: '', number: '' }), name: t, nameEn: undefined })} />
              <TextInput style={styles.input} placeholder="Set (optional)" placeholderTextColor={colors.muted} value={picked?.setName ?? ''} onChangeText={(t) => setPicked({ ...(picked ?? { name: '', number: '' }), setName: t })} />
              <TextInput style={styles.input} placeholder="Nummer (optional, z. B. 4/102)" placeholderTextColor={colors.muted} value={picked?.number ?? ''} onChangeText={(t) => setPicked({ ...(picked ?? { name: '', setName: '' }), number: t })} />
            </View>
          ) : (
            <>
              <TextInput
                style={styles.input}
                placeholder="Karte suchen (deutsch oder englisch)"
                placeholderTextColor={colors.muted}
                value={q}
                onChangeText={setQ}
                autoCorrect={false}
              />
              {searching && <ActivityIndicator style={{ marginTop: 8 }} color={colors.accent} />}
              <View style={styles.hits}>
                {(searchable ? hits : []).slice(0, 60).map((h) => (
                  <Pressable key={h.id} style={styles.hit} onPress={() => pick(h)}>
                    <FallbackImage
                      uris={h.thumbs}
                      style={styles.hitImg}
                      fallback={<View style={[styles.hitImg, { backgroundColor: colors.chip }]} />}
                    />
                    <Text style={styles.hitText} numberOfLines={1}>
                      {h.id}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <Pressable
            onPress={() => {
              setManual(!manual);
              setPicked(null);
            }}
          >
            <Text style={styles.link}>{manual ? 'Doch in der Datenbank suchen' : 'Nicht gefunden? Von Hand eintragen (z. B. japanische Karten)'}</Text>
          </Pressable>

          <Text style={styles.h}>Grading-Firma</Text>
          <View style={styles.wrapRow}>
            {COMPANIES.map((c) => (
              <Chip key={c} label={c} active={company === c} onPress={() => setCompany(c)} />
            ))}
          </View>
          <Text style={styles.h}>Note</Text>
          <View style={styles.wrapRow}>
            {GRADES.map((g) => (
              <Chip key={g} label={g} active={grade === g} onPress={() => setGrade(g)} />
            ))}
          </View>
          <Text style={styles.h}>Sprache der Karte</Text>
          <View style={styles.wrapRow}>
            {LANGUAGES.map((l) => (
              <Chip key={l.id} label={l.label} active={language === l.id} onPress={() => setLanguage(l.id)} />
            ))}
          </View>
          <Text style={styles.h}>Zertifikatsnummer (optional)</Text>
          <TextInput style={styles.input} value={cert} onChangeText={setCert} keyboardType="number-pad" placeholder="z. B. 12345678" placeholderTextColor={colors.muted} />
        </ScrollView>
      </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: colors.chip, borderRadius: 12, padding: 3, marginBottom: 14 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  segActive: { backgroundColor: colors.card },
  segText: { fontSize: 16, fontWeight: '700', color: colors.muted },
  segTextActive: { color: colors.text },
  title: { fontSize: 30, fontWeight: '800', color: colors.text, marginBottom: 12 },
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
  wide: { alignSelf: 'center', marginTop: 10, maxWidth: 520, width: '100%' },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 8, marginBottom: 6, gap: 10 },
  thumb: { width: 48, height: 67, borderRadius: 4, backgroundColor: colors.chip },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 1 },
  metaCenter: { fontSize: 12, color: colors.muted, marginTop: 1, textAlign: 'center' },
  badge: { alignSelf: 'flex-start', backgroundColor: colors.strong, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
  badgeText: { color: colors.onStrong, fontSize: 11, fontWeight: '700' },
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
  bigImg: { width: 260, height: 362, borderRadius: 12, marginBottom: 10 },
  box: { backgroundColor: colors.card, borderRadius: 12, padding: 14, alignSelf: 'center', alignItems: 'center', marginTop: 12, maxWidth: 520, width: '100%' },
  priceBig: { fontSize: 28, fontWeight: '800', color: colors.text },
  h: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 18, marginBottom: 8 },
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
  link: { color: colors.accent, fontWeight: '600', marginTop: 10, fontSize: 13 },
  hits: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  hit: { width: 76 },
  hitImg: { width: 76, height: 106, borderRadius: 4 },
  hitText: { fontSize: 9, color: colors.muted, marginTop: 2 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 },
});
