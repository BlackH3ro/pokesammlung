import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { isMergedChild, loadSeries, parentSet } from './api';

// All cards of all sets (German + English names) on the phone, so the live scanner can match a card
// without asking the internet for every frame.

export type IndexCard = { id: string; setId: string; de?: string; en?: string };
export type CardIndex = {
  byNumber: Map<string, IndexCard[]>; // "25", "TG5", "SV49" → cards with that number
  printed: Map<string, number>; // set id → count printed on the cards ("…/165")
  ids: Set<string>; // every card the scanner may report
};

const API = 'https://api.tcgdex.net/v2/';
const MAX_AGE = 7 * 24 * 3600 * 1000;
type Stored = { at: number; cards: [string, string | null, string | null][] };

// "025" → "25", "TG05" → "TG5", "SV049" → "SV49"; letters-only ids (Unown "!") have no number.
export function numberKey(prefix: string, digits: string) {
  return prefix.toUpperCase() + String(parseInt(digits, 10));
}

function localKey(localId: string) {
  const m = /^([A-Za-z]{0,3})0*(\d+)$/.exec(localId.trim());
  return m ? numberKey(m[1], m[2]) : null;
}

async function download(): Promise<Stored> {
  const [de, en] = await Promise.all(
    ['de', 'en'].map((l) => fetch(API + l + '/cards').then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))),
  );
  const names = new Map<string, [string, string | null, string | null]>();
  for (const c of en as any[]) names.set(c.id, [c.id, null, c.name]);
  for (const c of de as any[]) names.set(c.id, [c.id, c.name, names.get(c.id)?.[2] ?? null]);
  return { at: Date.now(), cards: [...names.values()] };
}

async function stored(): Promise<Stored> {
  if (Platform.OS === 'web') return download();
  const file = new File(Paths.document, 'card-index.json');
  let old: Stored | null = null;
  if (file.exists) old = await file.text().then(JSON.parse).catch(() => null);
  if (old && Date.now() - old.at < MAX_AGE) return old;
  try {
    const fresh = await download();
    if (file.exists) file.delete();
    file.create();
    await file.write(JSON.stringify(fresh));
    return fresh;
  } catch (e) {
    if (old) return old; // offline: an old index is still fine
    throw e;
  }
}

let index: Promise<CardIndex> | null = null;

export function loadCardIndex(): Promise<CardIndex> {
  index ??= Promise.all([stored(), loadSeries()])
    .then(([data, series]) => {
      const printed = new Map<string, number>();
      for (const s of series.flatMap((x) => x.sets)) printed.set(s.id, s.printed ?? s.official);
      const byNumber = new Map<string, IndexCard[]>();
      const ids = new Set<string>();
      for (const [id, de, en] of data.cards) {
        const sep = id.lastIndexOf('-');
        const setId = id.slice(0, sep);
        const key = localKey(id.slice(sep + 1));
        // Only sets the app lists (no TCG Pocket); merged sub-sets are only matched in set-locked mode.
        if (!key || !printed.has(setId) || isMergedChild(setId) || parentSet(setId) !== setId) continue;
        const list = byNumber.get(key) ?? [];
        list.push({ id, setId, de: de ?? undefined, en: en ?? undefined });
        ids.add(id);
        byNumber.set(key, list);
      }
      return { byNumber, printed, ids };
    })
    .catch((e) => {
      index = null; // try again next time
      throw e;
    });
  return index;
}
