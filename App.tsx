import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { SetBrief } from './src/api';
import { cardsValue, CollectionProvider, isAlarm, useCollection } from './src/collection';
import { refreshDue, refreshPrices } from './src/refresh';
import CollectionScreen from './src/CollectionScreen';
import HomeScreen from './src/HomeScreen';
import ScanScreen from './src/ScanScreen';
import SetScreen from './src/SetScreen';
import { SettingsProvider, SettingsSheet, useSettings } from './src/settings';
import SlabsScreen from './src/SlabsScreen';
import WantsScreen from './src/WantsScreen';
import { Palette, ThemeProvider, useColors, useTheme, useThemedStyles } from './src/theme';

type Tab = 'sets' | 'collection' | 'scan' | 'wants' | 'slabs';

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'sets', label: 'Sets', glyph: '▤' },
  { id: 'collection', label: 'Sammlung', glyph: '◫' },
  { id: 'scan', label: 'Scannen', glyph: '◉' },
  { id: 'wants', label: 'Wünsche', glyph: '♡' },
  { id: 'slabs', label: 'Slabs', glyph: '▣' },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ThemedApp />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

function ThemedApp() {
  const { settings } = useSettings();
  return (
    <ThemeProvider mode={settings.theme}>
      <CollectionProvider>
        <Main />
      </CollectionProvider>
    </ThemeProvider>
  );
}

function Main() {
  const colors = useColors();
  const { dark } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [tab, setTab] = useState<Tab>('sets');
  const [openSet, setOpenSet] = useState<SetBrief | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const col = useCollection();
  const refreshing = useRef(false);

  // Once every 12 h: fresh Cardmarket prices for owned and wanted cards (feeds value history + price alarms).
  useEffect(() => {
    // Also refresh once when stored card data predates the 30-day averages.
    const stale = Object.values(col.meta).some((m) => m.variants.some((v) => v.avg30 === undefined));
    if (!col.ready || refreshing.current || (!refreshDue(col.wantsCheckedAt) && !stale)) return;
    refreshing.current = true;
    const ownedIds = [...new Set(Object.keys(col.owned).map((k) => k.split('|')[0]))];
    refreshPrices(ownedIds, col.meta, col.wants)
      .then(({ cards, wantPrices }) => {
        col.remember(cards);
        col.applyWantPrices(wantPrices);
      })
      .catch(() => {})
      .finally(() => (refreshing.current = false));
  }, [col.ready]);

  // Today's total value for the history chart.
  const totalCards = cardsValue(col.owned, col.meta);
  const totalSlabs = col.slabs.reduce((s, x) => s + (x.price?.value ?? 0), 0);
  useEffect(() => {
    if (col.ready && (totalCards > 0 || totalSlabs > 0)) col.recordValue(totalCards, totalSlabs);
  }, [col.ready, totalCards, totalSlabs]);

  const alarms = Object.values(col.wants).filter(isAlarm).length;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab === 'sets' && openSet) {
        setOpenSet(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [tab, openSet]);

  const showSet = (s: SetBrief) => {
    setOpenSet(s);
    setTab('sets');
  };

  return (
          <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
            <StatusBar style={dark ? 'light' : 'dark'} />
            <View style={styles.nav}>
              {tab === 'sets' && openSet ? (
                <Pressable onPress={() => setOpenSet(null)} hitSlop={10}>
                  <Text style={styles.navBtn}>‹ Sets</Text>
                </Pressable>
              ) : (
                <View />
              )}
              <Pressable onPress={() => setSettingsOpen(true)} hitSlop={10}>
                <Text style={styles.navBtn}>Einstellungen</Text>
              </Pressable>
            </View>

            <View style={{ flex: 1 }}>
              {tab === 'sets' &&
                (openSet ? <SetScreen key={openSet.id} brief={openSet} /> : <HomeScreen onOpenSet={setOpenSet} />)}
              {tab === 'collection' && <CollectionScreen onOpenSet={showSet} />}
              {tab === 'scan' && <ScanScreen onOpenSettings={() => setSettingsOpen(true)} />}
              {tab === 'wants' && <WantsScreen onOpenSet={showSet} />}
              {tab === 'slabs' && <SlabsScreen onOpenSettings={() => setSettingsOpen(true)} />}
            </View>

            <View style={styles.tabBar}>
              {TABS.map((t) => (
                <Pressable
                  key={t.id}
                  style={styles.tab}
                  onPress={() => (t.id === tab && t.id === 'sets' ? setOpenSet(null) : setTab(t.id))}
                >
                  <Text style={[styles.glyph, tab === t.id && styles.active]}>{t.glyph}</Text>
                  {t.id === 'wants' && alarms > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{alarms}</Text>
                    </View>
                  )}
                  <Text style={[styles.tabLabel, tab === t.id && styles.active]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
            <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
          </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.bg,
  },
  navBtn: { fontSize: 16, color: colors.accent, fontWeight: '600' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  glyph: { fontSize: 20, color: colors.muted },
  tabLabel: { fontSize: 11, color: colors.muted, marginTop: 2, fontWeight: '500' },
  active: { color: colors.accent },
  badge: {
    position: 'absolute',
    top: 4,
    left: '55%',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.good,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
