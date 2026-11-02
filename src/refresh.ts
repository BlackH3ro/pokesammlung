import { getCard } from './api';
import type { CardMeta, Want } from './collection';

const HOURS = 12;

export const refreshDue = (last: number) => Date.now() - last > HOURS * 3600e3;

// Fetches fresh Cardmarket prices for every owned card and every wanted card.
export async function refreshPrices(
  ownedIds: string[],
  meta: Record<string, CardMeta>,
  wants: Record<string, Want>,
): Promise<{ cards: CardMeta[]; wantPrices: Record<string, number | null> }> {
  const ids = [...new Set([...ownedIds, ...Object.values(wants).map((w) => w.card.id)])];
  const fresh = new Map<string, CardMeta>();
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const res = await getCard(id).catch(() => null);
      if (!res) continue;
      const known = meta[id];
      // Keep the app's own set grouping and numbering (e.g. Classic Collection inside "30 Jahre").
      fresh.set(id, { ...res.card, setId: known?.setId ?? res.setId, setName: known?.setName ?? res.setName, localId: known?.localId ?? res.card.localId });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));

  const wantPrices: Record<string, number | null> = {};
  for (const w of Object.values(wants)) {
    const c = fresh.get(w.card.id);
    if (c) wantPrices[w.key] = c.variants.find((v) => v.key === w.vKey)?.price ?? null;
  }
  return { cards: ownedIds.map((id) => fresh.get(id)).filter((c): c is CardMeta => !!c), wantPrices };
}
