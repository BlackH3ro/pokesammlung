import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Palette, ThemeMode, useColors, useThemedStyles } from './theme';
import { exportBackup, pickBackup } from './backup';
import { BackupData, useCollection } from './collection';
import { Chip } from './ui';


export type Settings = {
  ocrKey: string; // ocr.space; empty = public demo key (very limited)
  ebayClientId: string;
  ebayClientSecret: string;
  theme: ThemeMode;
  scanZoom: number; // live scanner: 0 = automatic
  scanShift: number; // live scanner: −1 … 1, visible part of the picture
};

const EMPTY: Settings = { ocrKey: '', ebayClientId: '', ebayClientSecret: '', theme: 'system', scanZoom: 0, scanShift: 0 };
const KEY = 'settings:v1';

const SettingsContext = createContext<{ settings: Settings; save: (s: Settings) => void } | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(EMPTY);
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSettings({ ...EMPTY, ...JSON.parse(raw) }))
      .catch(() => {});
  }, []);
  const save = (s: Settings) => {
    setSettings(s);
    AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
  };
  return <SettingsContext.Provider value={{ settings, save }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings outside provider');
  return ctx;
}

export function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible && <SettingsForm onClose={onClose} />}
    </Modal>
  );
}

// Mounted fresh on every open, so the draft starts from the saved settings.
function SettingsForm({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { settings, save } = useSettings();
  const [draft, setDraft] = useState(settings);
  const col = useCollection();
  const [pending, setPending] = useState<BackupData | null>(null);
  const [backupMsg, setBackupMsg] = useState('');

  const doExport = async () => {
    try {
      await exportBackup(col.snapshot());
      setBackupMsg('Sicherung erstellt.');
    } catch (e: any) {
      setBackupMsg('Fehler: ' + (e?.message ?? e));
    }
  };
  const doPick = async () => {
    try {
      const data = await pickBackup();
      if (data) setPending(data);
    } catch (e: any) {
      setBackupMsg('Fehler: ' + (e?.message ?? e));
    }
  };
  const apply = (merge: boolean) => {
    if (!pending) return;
    col.restore(pending, merge);
    setBackupMsg(merge ? 'Sicherung zusammengeführt.' : 'Sicherung wiederhergestellt.');
    setPending(null);
  };

  const field = (label: string, key: 'ocrKey' | 'ebayClientId' | 'ebayClientSecret', secret = false) => (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={draft[key]}
        onChangeText={(t) => setDraft({ ...draft, [key]: t.trim() })}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secret}
        placeholder="nicht gesetzt"
        placeholderTextColor={colors.muted}
      />
    </View>
  );

  return (
      <View style={styles.wrap}>
        <View style={styles.top}>
          <Text style={styles.title}>Einstellungen</Text>
          <Pressable
            onPress={() => {
              save(draft);
              onClose();
            }}
            hitSlop={10}
          >
            <Text style={styles.done}>Sichern</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.h}>Sicherung</Text>
          <Text style={styles.p}>
            Deine Sammlung liegt nur auf diesem Gerät. Speichere regelmäßig eine Sicherung (z. B. in „Dateien“ oder iCloud) – damit
            kannst du sie auch auf ein anderes Gerät übertragen.
          </Text>
          <View style={styles.btnRow}>
            <Pressable style={styles.btn} onPress={doExport}>
              <Text style={styles.btnText}>Sicherung exportieren</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnLight]} onPress={doPick}>
              <Text style={[styles.btnText, { color: colors.text }]}>Sicherung laden</Text>
            </Pressable>
          </View>
          {pending && (
            <View style={styles.pending}>
              <Text style={styles.label}>
                Sicherung vom {new Date(pending.exportedAt).toLocaleDateString('de-DE')}: {Object.keys(pending.owned).length} Einträge,{' '}
                {pending.slabs.length} Slabs, {Object.keys(pending.wants).length} Wünsche
              </Text>
              <View style={styles.btnRow}>
                <Pressable style={styles.btn} onPress={() => apply(true)}>
                  <Text style={styles.btnText}>Zusammenführen</Text>
                </Pressable>
                <Pressable style={[styles.btn, { backgroundColor: colors.text }]} onPress={() => apply(false)}>
                  <Text style={[styles.btnText, { color: colors.bg }]}>Alles ersetzen</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => setPending(null)}>
                <Text style={styles.link}>Abbrechen</Text>
              </Pressable>
            </View>
          )}
          {!!backupMsg && <Text style={styles.p}>{backupMsg}</Text>}

          <Text style={styles.h}>Darstellung</Text>
          <View style={{ flexDirection: 'row', marginBottom: 8 }}>
            {(
              [
                ['system', 'Wie iPhone'],
                ['light', 'Hell'],
                ['dark', 'Dunkel'],
              ] as [ThemeMode, string][]
            ).map(([id, label]) => (
              <Chip key={id} label={label} active={draft.theme === id} onPress={() => setDraft({ ...draft, theme: id })} />
            ))}
          </View>

          <Text style={styles.h}>Karten-Scanner (OCR.space)</Text>
          <Text style={styles.p}>
            Auf dem iPhone liest die App die Karten direkt auf dem Gerät – dafür braucht es keinen Schlüssel. OCR.space wird
            nur in der Browser-Vorschau benutzt. Ohne eigenen Schlüssel nutzt die App den öffentlichen Demo-Schlüssel, der schnell ans Limit kommt. Ein kostenloser
            Schlüssel reicht für 25.000 Scans im Monat.
          </Text>
          <Pressable onPress={() => Linking.openURL('https://ocr.space/ocrapi/freekey')}>
            <Text style={styles.link}>Kostenlosen Schlüssel holen ›</Text>
          </Pressable>
          {field('API-Schlüssel', 'ocrKey')}

          <Text style={styles.h}>Slab-Preise (eBay)</Text>
          <Text style={styles.p}>
            Die Preise kommen aus aktuellen Angeboten auf eBay.de (Median in Euro). Dafür brauchst du einen kostenlosen
            eBay-Entwicklerzugang: anmelden, „Application Keys“ für Production erstellen und hier App ID und Cert ID eintragen.
          </Text>
          <Pressable onPress={() => Linking.openURL('https://developer.ebay.com/my/keys')}>
            <Text style={styles.link}>eBay-Entwicklerzugang öffnen ›</Text>
          </Pressable>
          {field('App ID (Client ID)', 'ebayClientId')}
          {field('Cert ID (Client Secret)', 'ebayClientSecret', true)}
          <Text style={styles.p}>Die Schlüssel bleiben nur auf diesem Gerät gespeichert.</Text>
        </ScrollView>
      </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  btnRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  btn: { flex: 1, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  btnLight: { backgroundColor: colors.chip },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  pending: { backgroundColor: colors.card, borderRadius: 10, padding: 12, marginBottom: 8, gap: 8 },
  wrap: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
  done: { fontSize: 17, color: colors.accent, fontWeight: '600' },
  h: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 12, marginBottom: 4 },
  p: { fontSize: 13, color: colors.muted, marginBottom: 8, lineHeight: 18 },
  link: { color: colors.accent, fontWeight: '600', marginBottom: 10 },
  label: { fontSize: 13, color: colors.text, marginBottom: 4, fontWeight: '500' },
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
});
