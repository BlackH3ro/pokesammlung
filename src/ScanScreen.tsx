import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, cardImages, getCard, loadSeries, loadSet, SetBrief, SetDetail } from './api';
import { CardIndex, loadCardIndex } from './cardIndex';
import { Lang, LANGS, useCollection } from './collection';
import { ImageHit, LiveCamera } from './LiveCamera';
import { asianLang, combineHits, detectLang, hasOnDeviceOcr, Match, matchCard, matchCardInSet, matchLive, ocr, ocrOnDevice, parseNumber } from './recognize';
import { useSettings } from './settings';
import { Chip, eur, FallbackImage } from './ui';
import { Palette, useColors, useThemedStyles } from './theme';

type Scan = { id: number; card: Card; setId: string; setName: string; vKey: string; unsure: boolean; lang?: Lang };
type VariantPref = 'normal' | 'reverse';

function pickVariant(card: Card, pref: VariantPref) {
  if (pref === 'reverse') {
    const r = card.variants.find((v) => v.key.startsWith('reverse'));
    if (r) return r.key;
  }
  return card.variants[0].key;
}

const haptic = (type: Haptics.NotificationFeedbackType) => {
  if (Platform.OS !== 'web') Haptics.notificationAsync(type).catch(() => {});
};

export default function ScanScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const col = useCollection();
  const { settings, save } = useSettings();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pref, setPref] = useState<VariantPref>('normal');
  const [lockedSet, setLockedSet] = useState<SetDetail | null>(null);
  const [picking, setPicking] = useState(false);
  const lockedRef = useRef<SetDetail | null>(null);
  useEffect(() => {
    lockedRef.current = lockedSet;
  }, [lockedSet]);
  const [status, setStatus] = useState(LiveCamera ? 'Lade Kartenliste …' : 'Karte in den Rahmen legen');
  const [scans, setScans] = useState<Scan[]>([]);
  const lastSeen = useRef<string | null>(null);
  const prefRef = useRef(pref);
  useEffect(() => {
    prefRef.current = pref;
  }, [pref]);

  // Photo → text. On the iPhone the text is read on the device; only the web preview still uploads to OCR.space.
  async function readCard(): Promise<string> {
    const photo = await cam.current!.takePictureAsync({ quality: 0.5, shutterSound: false });
    const ctx = ImageManipulator.manipulate(photo.uri);
    ctx.resize({ width: 1100 }); // also bakes in the orientation
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: !hasOnDeviceOcr });
    return hasOnDeviceOcr ? ocrOnDevice(out.uri) : ocr(out.base64 ?? '', settings.ocrKey);
  }

  function addMatch(match: Match, lang?: Lang) {
    const vKey = pickVariant(match.card, prefRef.current);
    col.addOne({ id: match.setId, name: match.setName }, match.card, vKey, lang);
    setScans((s) => [{ id: Date.now(), ...match, vKey, unsure: !match.confident, lang }, ...s].slice(0, 200));
    setStatus(`✓ ${match.card.name} (${match.setName} ${match.card.localId})${match.confident ? '' : ' – bitte prüfen'}`);
    haptic(Haptics.NotificationFeedbackType.Success);
  }

  // ---- Live mode (iPhone): text arrives several times a second straight from the video ----
  const [paused, setPaused] = useState(false);
  const [torch, setTorch] = useState(false);
  const idx = useRef<CardIndex | null>(null);
  const live = useRef({ candidate: '', streak: 0, lastAdded: '', lang: undefined as Lang | undefined, working: false, asianAt: 0, asianLang: undefined as Lang | undefined });
  const [zoomNow, setZoomNow] = useState<number | null>(null);
  // Zoom and visible part are kept, so a Cardslinger setup only has to be set once.
  const setView = (zoom: number, shift: number) => save({ ...settings, scanZoom: zoom, scanShift: Math.round(shift * 10) / 10 });
  const stepZoom = (d: number) => {
    const base = settings.scanZoom || zoomNow || 1;
    setView(Math.min(5, Math.max(1, Math.round((base + d) * 4) / 4)), settings.scanShift);
  };

  useEffect(() => {
    if (!LiveCamera) return;
    loadCardIndex()
      .then((i) => {
        idx.current = i;
        setStatus('Karte ins Bild halten');
      })
      .catch(() => setStatus('Kartenliste konnte nicht geladen werden – Internet prüfen'));
  }, []);

  async function onFrame(text: string, image?: ImageHit[], asianPass?: boolean) {
    const L = live.current;
    // Japanese writing only shows up in the Japanese passes (every 4th frame); remember it for a moment.
    const asian = asianLang(text);
    if (asian) {
      L.asianAt = Date.now();
      L.asianLang = asian;
    } else if (asianPass && Date.now() - L.asianAt > 1500) L.asianAt = 0;
    const isAsian = Date.now() - L.asianAt < 2500;
    if (asianPass && !asian && !isAsian) return; // the Latin passes do the rest
    if (L.working) return;
    const locked = lockedRef.current;
    L.working = true;
    try {
      let hit: { id: string; confident: boolean; match?: Match } | null = null;
      if (locked) {
        const m = await matchCardInSet(text, locked);
        if (m) hit = { id: m.card.id, confident: m.confident, match: m };
      } else if (idx.current) {
        const known = idx.current.ids;
        hit = combineHits(isAsian ? null : matchLive(text, idx.current), image, (id) => known.has(id), isAsian);
      }
      if (!hit) {
        L.candidate = '';
        L.streak = 0;
        if (idx.current || locked) setStatus(parseNumber(text) ? 'Nummer gelesen – Karte gerade halten' : 'Karte ins Bild halten');
        return;
      }
      // The card just saved is never saved again automatically – only after another card (a second copy goes via +1).
      if (hit.id === L.lastAdded) return;
      L.streak = hit.id === L.candidate ? L.streak + 1 : 1;
      L.candidate = hit.id;
      L.lang = isAsian ? L.asianLang : (detectLang(text) ?? (L.streak === 1 ? undefined : L.lang));
      // Two matching frames in a row; more when the name was not readable.
      if (L.streak < (hit.confident ? 2 : 6)) {
        setStatus('Erkenne …');
        return;
      }
      let match = hit.match ?? null;
      if (!match) {
        const res = await getCard(hit.id);
        if (res) match = { card: res.card, setId: res.setId, setName: res.setName, confident: hit.confident };
      }
      if (!match) return;
      L.lastAdded = hit.id;
      L.candidate = '';
      L.streak = 0;
      addMatch(match, L.lang);
    } catch (e: any) {
      setStatus('Fehler: ' + (e?.message ?? String(e)));
    } finally {
      L.working = false;
    }
  }

  // One capture → OCR → match → add. Returns false on a hard error (e.g. OCR limit).
  async function scanOnce(isAuto: boolean): Promise<boolean> {
    try {
      setStatus('Lese Karte …');
      const text = await readCard();
      const locked = lockedRef.current;
      const match = locked ? await matchCardInSet(text, locked) : await matchCard(text);
      if (!match) {
        setStatus(text.trim() ? 'Nummer nicht gefunden – Karte gerade halten' : 'Keine Karte erkannt');
        if (!isAuto) haptic(Haptics.NotificationFeedbackType.Warning);
        return true;
      }
      if (isAuto && match.card.id === lastSeen.current) {
        setStatus(`${match.card.name} liegt noch – warte auf die nächste Karte`);
        return true;
      }
      lastSeen.current = match.card.id;
      addMatch(match, detectLang(text) ?? undefined);
      return true;
    } catch (e: any) {
      setStatus('Fehler: ' + (e?.message ?? String(e)));
      haptic(Haptics.NotificationFeedbackType.Error);
      return false;
    }
  }

  // Continuous mode for the Cardslinger: scan back-to-back while running.
  useEffect(() => {
    if (!auto || !ready) return;
    let stop = false;
    (async () => {
      lastSeen.current = null;
      while (!stop) {
        setBusy(true);
        const ok = await scanOnce(true);
        setBusy(false);
        await new Promise((r) => setTimeout(r, ok ? 100 : 2000));
      }
    })();
    return () => {
      stop = true;
    };
  }, [auto, ready]);

  const single = async () => {
    if (busy || !ready) return;
    setBusy(true);
    await scanOnce(false);
    setBusy(false);
  };

  const undo = (s: Scan) => {
    col.setCount({ id: s.setId, name: s.setName }, s.card, s.vKey, col.count(s.card.id, s.vKey) - 1, s.lang);
    setScans((list) => list.filter((x) => x.id !== s.id));
  };

  // A second copy of a scanned card is added by hand – the scanner never saves the same card twice in a row.
  const addAgain = (s: Scan) => {
    col.addOne({ id: s.setId, name: s.setName }, s.card, s.vKey, s.lang);
    setScans((list) => [{ ...s, id: Date.now() }, ...list].slice(0, 200));
    haptic(Haptics.NotificationFeedbackType.Success);
  };

  const cycleVariant = (s: Scan) => {
    const i = s.card.variants.findIndex((v) => v.key === s.vKey);
    const next = s.card.variants[(i + 1) % s.card.variants.length].key;
    if (next === s.vKey) return;
    const set = { id: s.setId, name: s.setName };
    col.setCount(set, s.card, s.vKey, col.count(s.card.id, s.vKey) - 1, s.lang);
    col.addOne(set, s.card, next, s.lang);
    setScans((list) => list.map((x) => (x.id === s.id ? { ...x, vKey: next } : x)));
  };

  if (!permission) return <View style={styles.center} />;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.p}>Zum Scannen braucht die App Zugriff auf die Kamera.</Text>
        <Pressable style={styles.bigBtn} onPress={requestPermission}>
          <Text style={styles.bigBtnText}>Kamera erlauben</Text>
        </Pressable>
      </View>
    );
  }

  const sessionValue = scans.reduce((sum, s) => sum + (s.card.variants.find((v) => v.key === s.vKey)?.price ?? 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.camWrap}>
        {LiveCamera ? (
          <LiveCamera style={StyleSheet.absoluteFill} active={!paused} torch={torch}
            zoom={settings.scanZoom}
            shift={settings.scanShift}
            onText={(e) => {
              if (e.nativeEvent.zoom && e.nativeEvent.zoom !== zoomNow) setZoomNow(e.nativeEvent.zoom);
              onFrame(e.nativeEvent.text, e.nativeEvent.image, e.nativeEvent.asianPass);
            }}
          />
        ) : (
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" autofocus="on" onCameraReady={() => setReady(true)} />
        )}
        <View style={styles.frame} pointerEvents="none" />
        <View style={styles.statusBar}>
          <Text style={styles.statusText} numberOfLines={2}>
            {status}
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <View style={styles.row}>
          <Chip label="Normal" active={pref === 'normal'} onPress={() => setPref('normal')} />
          <Chip label="Reverse Holo" active={pref === 'reverse'} onPress={() => setPref('reverse')} />
          <Chip label={lockedSet ? `Set: ${lockedSet.name}` : 'Set: alle'} active={!!lockedSet} onPress={() => setPicking(true)} />
          <View style={{ flex: 1 }} />
          <Text style={styles.session}>
            {scans.length} · {eur(sessionValue)}
          </Text>
        </View>
        {LiveCamera ? (
          <View style={styles.row}>
            <Pressable style={[styles.bigBtn, { flex: 1 }, !paused && styles.stopBtn]} onPress={() => setPaused((p) => !p)}>
              <Text style={styles.bigBtnText}>{paused ? 'Weiter scannen' : 'Pause'}</Text>
            </Pressable>
            <Pressable style={[styles.bigBtn, { flex: 1 }]} onPress={() => setTorch((t) => !t)}>
              <Text style={styles.bigBtnText}>{torch ? 'Licht aus' : 'Licht an'}</Text>
            </Pressable>
          </View>
        ) : null}
        {LiveCamera ? (
          <View style={styles.row}>
            <Text style={styles.viewLabel}>Zoom</Text>
            <Pressable style={styles.viewBtn} onPress={() => stepZoom(-0.25)}>
              <Text style={styles.viewBtnText}>−</Text>
            </Pressable>
            <Pressable onPress={() => setView(0, settings.scanShift)}>
              <Text style={styles.viewValue}>
                {(settings.scanZoom || zoomNow || 1).toFixed(2).replace('.', ',')}×{settings.scanZoom ? '' : ' auto'}
              </Text>
            </Pressable>
            <Pressable style={styles.viewBtn} onPress={() => stepZoom(0.25)}>
              <Text style={styles.viewBtnText}>+</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Text style={styles.viewLabel}>Ausschnitt</Text>
            <Pressable style={styles.viewBtn} onPress={() => setView(settings.scanZoom, Math.max(-1, settings.scanShift - 0.25))}>
              <Text style={styles.viewBtnText}>▲</Text>
            </Pressable>
            <Pressable style={styles.viewBtn} onPress={() => setView(settings.scanZoom, Math.min(1, settings.scanShift + 0.25))}>
              <Text style={styles.viewBtnText}>▼</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.row}>
            <Pressable style={[styles.bigBtn, { flex: 1 }, (busy || auto) && styles.disabled]} onPress={single} disabled={busy || auto}>
              <Text style={styles.bigBtnText}>{busy && !auto ? 'Scanne …' : 'Einzeln scannen'}</Text>
            </Pressable>
            <Pressable style={[styles.bigBtn, { flex: 1 }, auto && styles.stopBtn]} onPress={() => setAuto((a) => !a)}>
              <Text style={styles.bigBtnText}>{auto ? 'Stopp' : 'Cardslinger-Modus'}</Text>
            </Pressable>
          </View>
        )}
        {!hasOnDeviceOcr && !settings.ocrKey && (
          <Pressable onPress={onOpenSettings}>
            <Text style={styles.hint}>Tipp: Mit einem kostenlosen OCR-Schlüssel in den Einstellungen geht es ohne Limit ›</Text>
          </Pressable>
        )}
      </View>

      <SetPicker
        visible={picking}
        current={lockedSet?.id}
        onClose={() => setPicking(false)}
        onPick={(set) => {
          setLockedSet(set);
          setPicking(false);
        }}
      />
      <FlatList
        data={scans}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        ListEmptyComponent={
          <Text style={styles.hint}>
            {LiveCamera
              ? 'Karte einfach ins Bild halten – sie wird automatisch erkannt und einmal eingetragen. Mit dem Cardslinger die Karten nacheinander durchlaufen lassen.'
              : 'Einzeln: Karte hinlegen und tippen. Cardslinger-Modus: Die App scannt durchgehend und trägt jede neue Karte ein.'}
          </Text>
        }
        renderItem={({ item }) => {
          const v = item.card.variants.find((x) => x.key === item.vKey);
          return (
            <View style={[styles.item, item.unsure && styles.unsure]}>
              <FallbackImage key={item.id} uris={cardImages(item.card)} style={styles.thumb} fallback={<View style={styles.thumb} />} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.card.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.setName} · {item.card.localId}
                  {item.lang ? ` · ${LANGS.find((l) => l.id === item.lang)?.label}` : ''}
                  {item.unsure ? ' · unsicher' : ''}
                </Text>
                <Pressable onPress={() => cycleVariant(item)} hitSlop={6}>
                  <Text style={styles.variant}>
                    {v?.label} {item.card.variants.length > 1 ? '⇄' : ''}
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.price}>{eur(v?.price)}</Text>
              <Pressable onPress={() => addAgain(item)} hitSlop={8} style={styles.again} accessibilityLabel="Noch ein Exemplar hinzufügen">
                <Text style={styles.againText}>+1</Text>
              </Pressable>
              <Pressable onPress={() => undo(item)} hitSlop={8} style={styles.undo}>
                <Text style={styles.undoText}>✕</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}


// Choose a set to scan against, or "all sets". Started sets come first.
function SetPicker(props: { visible: boolean; current?: string; onClose: () => void; onPick: (s: SetDetail | null) => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const col = useCollection();
  const [all, setAll] = useState<SetBrief[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    if (props.visible && !all.length) loadSeries().then((series) => setAll(series.flatMap((s) => s.sets))).catch(() => {});
  }, [props.visible]);

  const mine = all.filter((s) => col.started[s.id]);
  const needle = q.trim().toLowerCase();
  const rest = all.filter((s) => !col.started[s.id] && (!needle || s.name.toLowerCase().includes(needle)));

  const choose = async (s: SetBrief) => {
    setLoading(s.id);
    try {
      props.onPick(await loadSet(s.id));
    } finally {
      setLoading(null);
    }
  };

  const row = (s: SetBrief) => (
    <Pressable key={s.id} style={styles.pickRow} onPress={() => choose(s)}>
      <Text style={[styles.name, props.current === s.id && { color: colors.accent }]}>{s.name}</Text>
      {loading === s.id ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.meta}>{s.total} Karten</Text>}
    </Pressable>
  );

  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={styles.pickTop}>
          <Text style={[styles.name, { flex: 1, fontSize: 17 }]}>Set zum Scannen</Text>
          <Pressable onPress={props.onClose} hitSlop={10}>
            <Text style={styles.done}>Fertig</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>
            Liegt ein Stapel aus einem Set im Cardslinger, wähle es hier: Die App sucht dann nur in diesem Set und erkennt Karten auch
            über den Namen (z. B. Classic-Collection-Reprints).
          </Text>
          <Pressable style={styles.pickRow} onPress={() => props.onPick(null)}>
            <Text style={[styles.name, !props.current && { color: colors.accent }]}>Alle Sets (automatisch)</Text>
          </Pressable>
          {mine.length > 0 && <Text style={styles.pickH}>Meine Sets</Text>}
          {mine.map(row)}
          <Text style={styles.pickH}>Alle Sets</Text>
          <TextInput
            style={styles.pickSearch}
            placeholder="Set suchen"
            placeholderTextColor={colors.muted}
            value={q}
            onChangeText={setQ}
            autoCorrect={false}
          />
          {rest.slice(0, needle ? 60 : 25).map(row)}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  pickTop: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  done: { fontSize: 16, color: colors.accent, fontWeight: '600' },
  pickH: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  pickSearch: {
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  p: { color: colors.text, marginBottom: 16, textAlign: 'center' },
  viewLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  viewValue: { color: colors.text, fontSize: 14, fontWeight: '700', minWidth: 62, textAlign: 'center' },
  viewBtn: { width: 36, height: 32, borderRadius: 8, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center' },
  viewBtnText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  camWrap: { height: 340, backgroundColor: '#000', overflow: 'hidden' },
  frame: {
    position: 'absolute',
    alignSelf: 'center',
    top: 20,
    height: 280,
    aspectRatio: 0.716,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 12,
  },
  statusBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 8, backgroundColor: 'rgba(0,0,0,0.55)' },
  statusText: { color: '#fff', fontSize: 13, textAlign: 'center' },
  controls: { padding: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  session: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  bigBtn: { backgroundColor: colors.strong, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  stopBtn: { backgroundColor: colors.accent },
  disabled: { opacity: 0.4 },
  bigBtnText: { color: colors.onStrong, fontWeight: '700', fontSize: 15 },
  hint: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 4 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 8, marginTop: 6, gap: 10 },
  unsure: { borderWidth: 1.5, borderColor: '#F59E0B' },
  thumb: { width: 40, height: 56, borderRadius: 4, backgroundColor: colors.chip },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.muted },
  variant: { fontSize: 12, color: colors.accent, fontWeight: '600', marginTop: 2 },
  price: { fontSize: 14, fontWeight: '700', color: colors.text },
  again: { paddingHorizontal: 8, paddingVertical: 4, marginLeft: 8, borderRadius: 8, backgroundColor: colors.chip },
  againText: { fontSize: 14, fontWeight: '700', color: colors.text },
  undo: { padding: 6 },
  undoText: { fontSize: 16, color: colors.muted },
});
