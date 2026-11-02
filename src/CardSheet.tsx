import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Card, cardImages } from './api';
import { slotKey, useCollection } from './collection';
import GradingSheet from './GradingSheet';
import { eur, FallbackImage, Trend } from './ui';
import { Palette, useColors, useThemedStyles } from './theme';

type Props = { card: Card | null; set: { id: string; name: string }; onClose: () => void };

export default function CardSheet({ card, set, onClose }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const col = useCollection();
  const [grading, setGrading] = useState(false);
  if (!card) return null;
  
  const excluded = !!col.excluded[card.id];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} transparent={false}>
      <View style={styles.wrap}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={1}>
            {card.name}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.done}>Fertig</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, alignItems: 'center' }}>
          <FallbackImage key={card.id} uris={cardImages(card, 'high')} style={styles.img} resizeMode="contain" />
          <Text style={styles.meta}>
            {set.name} · Nr. {card.localId}
            {card.rarity ? ` · ${card.rarity}` : ''}
          </Text>

          <View style={styles.box}>
            {card.variants.map((v, i) => {
              const n = col.count(card.id, v.key);
              const change = (d: number) => col.setCount(set, card, v.key, Math.max(0, n + d));
              const wanted = !!col.wants[slotKey(card.id, v.key)];
              return (
                <View key={v.key} style={[styles.vRow, i > 0 && styles.sep]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vLabel}>{v.label}</Text>
                    <Text style={styles.vPrice}>
                      {v.price != null ? `${eur(v.price)} Trend` : 'kein Preis'}
                      {v.avg30 != null ? ` · Ø 30 Tage ${eur(v.avg30)}  ` : ''}
                      <Trend price={v.price} avg30={v.avg30} />
                    </Text>
                  </View>
                  <Pressable
                    style={styles.heart}
                    hitSlop={6}
                    onPress={() => (wanted ? col.removeWant(slotKey(card.id, v.key)) : col.setWant(set, card, v.key, null))}
                    accessibilityLabel={wanted ? 'Von der Wunschliste entfernen' : 'Auf die Wunschliste'}
                  >
                    <Text style={[styles.heartText, wanted && { color: colors.accent }]}>{wanted ? '♥' : '♡'}</Text>
                  </Pressable>
                  <Pressable style={styles.step} onPress={() => change(-1)}>
                    <Text style={styles.stepText}>−</Text>
                  </Pressable>
                  <Text style={[styles.count, n > 0 && { color: colors.good }]}>{n}</Text>
                  <Pressable style={styles.step} onPress={() => change(1)}>
                    <Text style={styles.stepText}>+</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          {card.variants.some((v) => v.history || v.avg30 != null) && (
            <View style={[styles.box, { paddingVertical: 12 }]}>
              <Text style={styles.vLabel}>Preisentwicklung (Cardmarket)</Text>
              {card.variants.map((v) => (
                <View key={v.key} style={{ marginTop: 8 }}>
                  {card.variants.length > 1 && <Text style={styles.vPrice}>{v.label}</Text>}
                  <View style={styles.histRow}>
                    {(
                      [
                        ['Ø 30 T', v.avg30],
                        ['Ø 7 T', v.history?.avg7],
                        ['Ø 1 T', v.history?.avg1],
                        ['Trend', v.price],
                        ['ab', v.history?.low],
                      ] as [string, number | null | undefined][]
                    ).map(([label, value]) => (
                      <View key={label} style={styles.histCell}>
                        <Text style={styles.histLabel}>{label}</Text>
                        <Text style={styles.histValue}>{value != null ? eur(value) : '–'}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={[styles.box, styles.vRow]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.vLabel}>Nicht mitzählen</Text>
              <Text style={styles.vPrice}>Karte zählt nicht zum Fortschritt und zu „Fehlt noch“ (z. B. extrem teure Promos).</Text>
            </View>
            <Switch value={excluded} onValueChange={() => col.toggleExcluded(card.id)} trackColor={{ true: colors.accent }} />
          </View>

          <Pressable style={styles.gradeBtn} onPress={() => setGrading(true)}>
            <Text style={styles.gradeText}>Grading-Rechner: lohnt sich das Graden?</Text>
          </Pressable>

          <Pressable
            style={styles.link}
            onPress={() =>
              Linking.openURL(
                'https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=' + encodeURIComponent(card.name),
              )
            }
          >
            <Text style={styles.linkText}>Auf Cardmarket suchen</Text>
          </Pressable>
          <Text style={styles.foot}>Preise: Cardmarket-Trend über TCGdex, täglich aktualisiert.</Text>
        </ScrollView>
      </View>
      {grading && <GradingSheet card={card} onClose={() => setGrading(false)} />}
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  histRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  histCell: { alignItems: 'center', flex: 1 },
  histLabel: { fontSize: 11, color: colors.muted },
  histValue: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 2 },
  heart: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  heartText: { fontSize: 22, color: colors.muted },
  gradeBtn: { backgroundColor: colors.chip, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', maxWidth: 520, width: '100%', alignSelf: 'center' },
  gradeText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  wrap: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.card,
  },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
  done: { fontSize: 17, color: colors.accent, fontWeight: '600' },
  img: { width: 280, height: 390, borderRadius: 12 },
  meta: { color: colors.muted, marginTop: 10, marginBottom: 12, textAlign: 'center' },
  box: { backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 14, alignSelf: 'stretch', marginBottom: 12, maxWidth: 520, width: '100%' },
  vRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  vLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  vPrice: { fontSize: 13, color: colors.muted, marginTop: 2 },
  step: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 20, color: colors.text, fontWeight: '600' },
  count: { width: 36, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.text },
  link: { marginTop: 4, padding: 12 },
  linkText: { color: colors.accent, fontWeight: '600', fontSize: 15 },
  foot: { fontSize: 11, color: colors.muted, marginTop: 8, textAlign: 'center' },
});
