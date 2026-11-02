import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, cardImages } from './api';
import { useCollection } from './collection';
import { matchCard, ocr } from './recognize';
import { useSettings } from './settings';
import { Chip, eur, FallbackImage } from './ui';
import { Palette, useColors, useThemedStyles } from './theme';

type Scan = { id: number; card: Card; setId: string; setName: string; vKey: string; unsure: boolean };
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
  const { settings } = useSettings();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pref, setPref] = useState<VariantPref>('normal');
  const [status, setStatus] = useState('Karte in den Rahmen legen');
  const [scans, setScans] = useState<Scan[]>([]);
  const lastSeen = useRef<string | null>(null);
  const prefRef = useRef(pref);
  useEffect(() => {
    prefRef.current = pref;
  }, [pref]);

  async function capture(): Promise<string> {
    const photo = await cam.current!.takePictureAsync({ quality: 0.7, shutterSound: false });
    const ctx = ImageManipulator.manipulate(photo.uri);
    ctx.resize({ width: 1100 });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
    return out.base64 ?? '';
  }

  // One capture → OCR → match → add. Returns false on a hard error (e.g. OCR limit).
  async function scanOnce(isAuto: boolean): Promise<boolean> {
    try {
      setStatus('Lese Karte …');
      const text = await ocr(await capture(), settings.ocrKey);
      const match = await matchCard(text);
      if (!match) {
        lastSeen.current = null; // gap between cards: the next card may be a duplicate again
        setStatus(text.trim() ? 'Nummer nicht gefunden – Karte gerade halten' : 'Keine Karte erkannt');
        if (!isAuto) haptic(Haptics.NotificationFeedbackType.Warning);
        return true;
      }
      if (isAuto && match.card.id === lastSeen.current) {
        setStatus(`${match.card.name} liegt noch – warte auf die nächste Karte`);
        return true;
      }
      lastSeen.current = match.card.id;
      const vKey = pickVariant(match.card, prefRef.current);
      col.addOne({ id: match.setId, name: match.setName }, match.card, vKey);
      setScans((s) => [{ id: Date.now(), ...match, vKey, unsure: !match.confident }, ...s].slice(0, 200));
      setStatus(`✓ ${match.card.name} (${match.setName} ${match.card.localId})${match.confident ? '' : ' – bitte prüfen'}`);
      haptic(Haptics.NotificationFeedbackType.Success);
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
        await new Promise((r) => setTimeout(r, ok ? 250 : 3000));
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
    col.setCount({ id: s.setId, name: s.setName }, s.card, s.vKey, col.count(s.card.id, s.vKey) - 1);
    setScans((list) => list.filter((x) => x.id !== s.id));
  };

  const cycleVariant = (s: Scan) => {
    const i = s.card.variants.findIndex((v) => v.key === s.vKey);
    const next = s.card.variants[(i + 1) % s.card.variants.length].key;
    if (next === s.vKey) return;
    const set = { id: s.setId, name: s.setName };
    col.setCount(set, s.card, s.vKey, col.count(s.card.id, s.vKey) - 1);
    col.addOne(set, s.card, next);
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
        <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" autofocus="on" onCameraReady={() => setReady(true)} />
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
          <View style={{ flex: 1 }} />
          <Text style={styles.session}>
            {scans.length} · {eur(sessionValue)}
          </Text>
        </View>
        <View style={styles.row}>
          <Pressable style={[styles.bigBtn, { flex: 1 }, (busy || auto) && styles.disabled]} onPress={single} disabled={busy || auto}>
            <Text style={styles.bigBtnText}>{busy && !auto ? 'Scanne …' : 'Einzeln scannen'}</Text>
          </Pressable>
          <Pressable style={[styles.bigBtn, { flex: 1 }, auto && styles.stopBtn]} onPress={() => setAuto((a) => !a)}>
            <Text style={styles.bigBtnText}>{auto ? 'Stopp' : 'Cardslinger-Modus'}</Text>
          </Pressable>
        </View>
        {!settings.ocrKey && (
          <Pressable onPress={onOpenSettings}>
            <Text style={styles.hint}>Tipp: Mit einem kostenlosen OCR-Schlüssel in den Einstellungen geht es ohne Limit ›</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={scans}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        ListEmptyComponent={
          <Text style={styles.hint}>
            Einzeln: Karte hinlegen und tippen. Cardslinger-Modus: Die App scannt durchgehend und trägt jede neue Karte ein.
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
                  {item.unsure ? ' · unsicher' : ''}
                </Text>
                <Pressable onPress={() => cycleVariant(item)} hitSlop={6}>
                  <Text style={styles.variant}>
                    {v?.label} {item.card.variants.length > 1 ? '⇄' : ''}
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.price}>{eur(v?.price)}</Text>
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

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  p: { color: colors.text, marginBottom: 16, textAlign: 'center' },
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  undo: { padding: 6 },
  undoText: { fontSize: 16, color: colors.muted },
});
