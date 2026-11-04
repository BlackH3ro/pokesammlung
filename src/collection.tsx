import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Card, SetDetail } from './api';

export type Mode = 'master' | 'base';

// What we remember about a card so the "Sammlung" tab works without reloading its set.
export type CardMeta = Card & { setId: string; setName: string };

export type SlabPrice = { value: number; n: number; at: number; query: string };

export type Sealed = {
  id: string;
  name: string; // e.g. "30 Jahre Elite-Trainer-Box"
  kind: string; // Display, ETB, Booster, …
  language: string;
  count: number;
  manualValue?: number | null; // per item, overrides the eBay price
  price?: SlabPrice; // per item, from eBay listings
  addedAt: number;
};

export const sealedValue = (x: Sealed) => (x.manualValue ?? x.price?.value ?? 0) * x.count;

export type Slab = {
  id: string;
  cardId?: string;
  name: string;
  nameEn?: string;
  setName: string;
  number: string;
  image?: string;
  language: string;
  company: string;
  grade: string;
  cert?: string;
  price?: SlabPrice;
  history?: { d: string; v: number }[]; // one price per day, for the chart
  addedAt: number;
};

export type Want = {
  key: string; // slotKey(cardId, variantKey)
  card: CardMeta;
  vKey: string;
  target: number | null; // alarm when the price is at or below this
  addedAt: number;
  price?: number | null; // last checked Cardmarket trend
  checkedAt?: number;
};

export const LANGS = [
  { id: 'de', label: 'DE' },
  { id: 'en', label: 'EN' },
  { id: 'fr', label: 'FR' },
  { id: 'it', label: 'IT' },
  { id: 'es', label: 'ES' },
  { id: 'pt', label: 'PT' },
  { id: 'ja', label: 'JP' },
  { id: 'ko', label: 'KO' },
  { id: 'zh', label: 'ZH' },
] as const;
export type Lang = (typeof LANGS)[number]['id'];

type State = {
  owned: Record<string, number>; // "cardId|variantKey" -> count
  // "cardId|variantKey" -> copies per language. May cover fewer copies than `owned` (language unknown).
  langs: Record<string, Partial<Record<Lang, number>>>;
  addedAt: Record<string, number>; // "cardId|variantKey" -> first time it was added
  excluded: Record<string, true>; // cardId -> not counted (e.g. ultra-rare promos)
  mode: Record<string, Mode>; // setId -> tracking mode
  started: Record<string, string>; // setId -> set name, for "Meine Sets"
  meta: Record<string, CardMeta>; // cardId -> card info
  slabs: Slab[];
  sealed: Sealed[];
  wants: Record<string, Want>;
  wantsCheckedAt: number;
  history: ValuePoint[]; // one entry per day
};

export type ValuePoint = { d: string; cards: number; slabs: number };

const EMPTY: State = { addedAt: {}, owned: {}, langs: {}, excluded: {}, mode: {}, started: {}, meta: {}, slabs: [], sealed: [], wants: {}, wantsCheckedAt: 0, history: [] };
const KEY = 'collection:v1';

export const slotKey = (cardId: string, variantKey: string) => `${cardId}|${variantKey}`;

type SetRef = { id: string; name: string };

type Ctx = State & {
  ready: boolean;
  count: (cardId: string, variantKey: string) => number;
  setCount: (set: SetRef, card: Card, variantKey: string, n: number, lang?: Lang) => void;
  addOne: (set: SetRef, card: Card, variantKey: string, lang?: Lang) => void;
  remember: (cards: CardMeta[]) => void;
  toggleExcluded: (cardId: string) => void;
  setMode: (setId: string, mode: Mode) => void;
  saveSlab: (slab: Slab) => void;
  removeSlab: (id: string) => void;
  saveSealed: (item: Sealed) => void;
  removeSealed: (id: string) => void;
  setWant: (set: SetRef, card: Card, variantKey: string, target: number | null) => void;
  setWants: (set: SetRef, items: { card: Card; variantKey: string }[]) => void;
  removeWant: (key: string) => void;
  applyWantPrices: (prices: Record<string, number | null>) => void;
  recordValue: (cards: number, slabs: number) => void;
  snapshot: () => BackupData;
  restore: (data: BackupData, merge: boolean) => void;
};

export type BackupData = State & { app: 'pokesammlung'; version: 1; exportedAt: string };

const CollectionContext = createContext<Ctx | null>(null);

export function CollectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setState({ ...EMPTY, ...JSON.parse(raw) }))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
  }, [state, ready]);

  const count = useCallback((cardId: string, v: string) => state.owned[slotKey(cardId, v)] ?? 0, [state.owned]);

  const update = useCallback((set: SetRef, card: Card, v: string, next: (n: number) => number, lang?: Lang) => {
    setState((s) => {
      const k = slotKey(card.id, v);
      const old = s.owned[k] ?? 0;
      const n = Math.max(0, next(old));
      const owned = { ...s.owned };
      const addedAt = { ...s.addedAt };
      if (n > 0) {
        if (!owned[k]) addedAt[k] = Date.now();
        owned[k] = n;
      } else {
        delete owned[k];
        delete addedAt[k];
      }
      let wants = s.wants;
      if (n > 0 && wants[k]) {
        wants = { ...wants };
        delete wants[k];
      }
      return {
        ...s,
        owned,
        langs: adjustLangs(s.langs, k, old, n, lang),
        addedAt,
        wants,
        started: { ...s.started, [set.id]: set.name },
        meta: { ...s.meta, [card.id]: { ...card, setId: set.id, setName: set.name } },
      };
    });
  }, []);

  const setCount = useCallback(
    (set: SetRef, card: Card, v: string, n: number, lang?: Lang) => update(set, card, v, () => n, lang),
    [update],
  );
  const addOne = useCallback((set: SetRef, card: Card, v: string, lang?: Lang) => update(set, card, v, (n) => n + 1, lang), [update]);

  const remember = useCallback((cards: CardMeta[]) => {
    // Overwrites existing entries so prices stay as fresh as the set data they came from.
    setState((s) => {
      if (!cards.length) return s;
      const meta = { ...s.meta };
      for (const c of cards) meta[c.id] = c;
      return { ...s, meta };
    });
  }, []);

  const toggleExcluded = useCallback((cardId: string) => {
    setState((s) => {
      const excluded = { ...s.excluded };
      if (excluded[cardId]) delete excluded[cardId];
      else excluded[cardId] = true;
      return { ...s, excluded };
    });
  }, []);

  const setMode = useCallback((setId: string, mode: Mode) => {
    setState((s) => ({ ...s, mode: { ...s.mode, [setId]: mode } }));
  }, []);

  const saveSlab = useCallback((input: Slab) => {
    setState((s) => {
      const prev = s.slabs.find((x) => x.id === input.id);
      // Every fetched price also goes into the slab's daily price history (latest price of the day wins).
      let history = prev?.history ?? input.history ?? [];
      if (input.price) {
        const d = new Date(input.price.at).toISOString().slice(0, 10);
        history = [...history.filter((h) => h.d !== d), { d, v: input.price.value }].sort((a, b) => a.d.localeCompare(b.d));
      }
      const slab = { ...input, history };
      const exists = !!prev;
      return { ...s, slabs: exists ? s.slabs.map((x) => (x.id === slab.id ? slab : x)) : [slab, ...s.slabs] };
    });
  }, []);

  const saveSealed = useCallback((item: Sealed) => {
    setState((s) => {
      const exists = s.sealed.some((x) => x.id === item.id);
      return { ...s, sealed: exists ? s.sealed.map((x) => (x.id === item.id ? item : x)) : [item, ...s.sealed] };
    });
  }, []);

  const removeSealed = useCallback((id: string) => {
    setState((s) => ({ ...s, sealed: s.sealed.filter((x) => x.id !== id) }));
  }, []);

  const removeSlab = useCallback((id: string) => {
    setState((s) => ({ ...s, slabs: s.slabs.filter((x) => x.id !== id) }));
  }, []);

  const setWant = useCallback((set: SetRef, card: Card, vKey: string, target: number | null) => {
    setState((s) => {
      const key = slotKey(card.id, vKey);
      const prev = s.wants[key];
      const price = card.variants.find((v) => v.key === vKey)?.price ?? null;
      const want: Want = prev
        ? { ...prev, target }
        : { key, card: { ...card, setId: set.id, setName: set.name }, vKey, target, addedAt: Date.now(), price, checkedAt: Date.now() };
      return { ...s, wants: { ...s.wants, [key]: want } };
    });
  }, []);

  const setWants = useCallback((set: SetRef, items: { card: Card; variantKey: string }[]) => {
    setState((s) => {
      const wants = { ...s.wants };
      for (const { card, variantKey } of items) {
        const key = slotKey(card.id, variantKey);
        if (wants[key] || s.owned[key]) continue;
        const price = card.variants.find((v) => v.key === variantKey)?.price ?? null;
        wants[key] = { key, card: { ...card, setId: set.id, setName: set.name }, vKey: variantKey, target: null, addedAt: Date.now(), price, checkedAt: Date.now() };
      }
      return { ...s, wants };
    });
  }, []);

  const removeWant = useCallback((key: string) => {
    setState((s) => {
      const wants = { ...s.wants };
      delete wants[key];
      return { ...s, wants };
    });
  }, []);

  const applyWantPrices = useCallback((prices: Record<string, number | null>) => {
    setState((s) => {
      const wants = { ...s.wants };
      for (const [key, price] of Object.entries(prices)) if (wants[key]) wants[key] = { ...wants[key], price, checkedAt: Date.now() };
      return { ...s, wants, wantsCheckedAt: Date.now() };
    });
  }, []);

  const recordValue = useCallback((cards: number, slabs: number) => {
    setState((s) => {
      const d = new Date().toISOString().slice(0, 10);
      const round = (n: number) => Math.round(n * 100) / 100;
      const point = { d, cards: round(cards), slabs: round(slabs) };
      const last = s.history[s.history.length - 1];
      if (last && last.d === d && last.cards === point.cards && last.slabs === point.slabs) return s;
      const history = last?.d === d ? [...s.history.slice(0, -1), point] : [...s.history, point];
      return { ...s, history };
    });
  }, []);

  const snapshot = useCallback(
    (): BackupData => ({ ...state, app: 'pokesammlung', version: 1, exportedAt: new Date().toISOString() }),
    [state],
  );

  // Replace everything, or merge: counts take the higher value, lists are combined.
  const restore = useCallback((data: BackupData, merge: boolean) => {
    const incoming: State = { ...EMPTY, ...data };
    setState((s) => {
      if (!merge) return incoming;
      const owned = { ...s.owned };
      for (const [k, n] of Object.entries(incoming.owned)) owned[k] = Math.max(owned[k] ?? 0, n);
      const langs = { ...s.langs };
      for (const [k, per] of Object.entries(incoming.langs)) {
        const mine = { ...langs[k] };
        for (const [l, n] of Object.entries(per)) mine[l as Lang] = Math.max(mine[l as Lang] ?? 0, n ?? 0);
        langs[k] = mine;
      }
      const slabIds = new Set(s.slabs.map((x) => x.id));
      const byDay = new Map(s.history.map((h) => [h.d, h]));
      for (const h of incoming.history) if (!byDay.has(h.d)) byDay.set(h.d, h);
      return {
        owned,
        langs,
        addedAt: { ...incoming.addedAt, ...s.addedAt },
        excluded: { ...incoming.excluded, ...s.excluded },
        mode: { ...incoming.mode, ...s.mode },
        started: { ...incoming.started, ...s.started },
        meta: { ...incoming.meta, ...s.meta },
        slabs: [...s.slabs, ...incoming.slabs.filter((x) => !slabIds.has(x.id))],
        sealed: [...s.sealed, ...incoming.sealed.filter((x) => !s.sealed.some((y) => y.id === x.id))],
        wants: { ...incoming.wants, ...s.wants },
        wantsCheckedAt: Math.max(s.wantsCheckedAt, incoming.wantsCheckedAt),
        history: [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d)),
      };
    });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      ready,
      count,
      setCount,
      addOne,
      remember,
      toggleExcluded,
      setMode,
      saveSlab,
      removeSlab,
      saveSealed,
      removeSealed,
      setWant,
      setWants,
      removeWant,
      applyWantPrices,
      recordValue,
      snapshot,
      restore,
    }),
    [state, ready, count, setCount, addOne, remember, toggleExcluded, setMode, saveSlab, removeSlab, saveSealed, removeSealed, setWant, setWants, removeWant, applyWantPrices, recordValue, snapshot, restore],
  );
  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>;
}

export function useCollection() {
  const ctx = useContext(CollectionContext);
  if (!ctx) throw new Error('useCollection outside provider');
  return ctx;
}

export type Stats = {
  have: number;
  need: number;
  ownedValue: number; // market value of everything you own in this set
  missingValue: number; // what the missing slots cost to buy
  setValue: number; // value of the whole (tracked) set
};

// In master mode every variant is a slot; in base mode a card counts once (its cheapest variant).
export function setStats(set: SetDetail, c: Pick<State, 'owned' | 'excluded'>, mode: Mode): Stats {
  const s: Stats = { have: 0, need: 0, ownedValue: 0, missingValue: 0, setValue: 0 };
  for (const card of set.cards) {
    const counts = card.variants.map((v) => c.owned[slotKey(card.id, v.key)] ?? 0);
    counts.forEach((n, i) => (s.ownedValue += n * (card.variants[i].price ?? 0)));
    if (c.excluded[card.id]) continue;
    if (mode === 'master') {
      card.variants.forEach((v, i) => {
        s.need++;
        s.setValue += v.price ?? 0;
        if (counts[i] > 0) s.have++;
        else s.missingValue += v.price ?? 0;
      });
    } else {
      const cheapest = Math.min(...card.variants.map((v) => v.price ?? Infinity));
      const price = isFinite(cheapest) ? cheapest : 0;
      s.need++;
      s.setValue += price;
      if (counts.some((n) => n > 0)) s.have++;
      else s.missingValue += price;
    }
  }
  return s;
}

// Keeps the per-language counts in step with a slot's new total. Added copies go to `lang`;
// removed ones come from `lang` first, then from the language with the most copies.
function adjustLangs(all: State['langs'], k: string, old: number, n: number, lang?: Lang): State['langs'] {
  const cur: Partial<Record<Lang, number>> = { ...all[k] };
  if (n > old && lang) cur[lang] = (cur[lang] ?? 0) + (n - old);
  if (n < old) {
    let drop = old - n;
    if (lang && cur[lang]) {
      const d = Math.min(cur[lang]!, drop);
      cur[lang]! -= d;
      drop -= d;
    }
    // Only assigned copies beyond the new total have to go; unknown-language copies are removed first.
    let extra = Object.values(cur).reduce((a, b) => a + (b ?? 0), 0) - n;
    for (const l of (Object.keys(cur) as Lang[]).sort((a, b) => (cur[b] ?? 0) - (cur[a] ?? 0))) {
      const d = Math.min(cur[l] ?? 0, Math.max(0, extra));
      cur[l] = (cur[l] ?? 0) - d;
      extra -= d;
    }
  }
  for (const l of Object.keys(cur) as Lang[]) if (!cur[l]) delete cur[l];
  if (!Object.keys(cur).length) {
    if (!all[k]) return all;
    const rest = { ...all };
    delete rest[k];
    return rest;
  }
  return { ...all, [k]: cur };
}

// "DE 2 · EN 1", plus "? 1" for copies without a known language.
export function langSummary(per: Partial<Record<Lang, number>> | undefined, total: number) {
  const parts = LANGS.filter((l) => per?.[l.id]).map((l) => `${l.label} ${per![l.id]}`);
  const known = Object.values(per ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  if (parts.length && total > known) parts.push(`? ${total - known}`);
  return parts.join(' · ');
}

export function cardComplete(card: Card, owned: Record<string, number>, mode: Mode) {
  const has = card.variants.map((v) => (owned[slotKey(card.id, v.key)] ?? 0) > 0);
  return mode === 'master' ? has.every(Boolean) : has.some(Boolean);
}

export function cardOwnedAny(card: Card, owned: Record<string, number>) {
  return card.variants.some((v) => (owned[slotKey(card.id, v.key)] ?? 0) > 0);
}

export const isAlarm = (w: Want) => w.target != null && w.price != null && w.price <= w.target;

// Total market value of owned cards, from the remembered card details.
export function cardsValue(owned: Record<string, number>, meta: Record<string, CardMeta>) {
  let sum = 0;
  for (const [key, n] of Object.entries(owned)) {
    const [cardId, vKey] = key.split('|');
    sum += n * (meta[cardId]?.variants.find((v) => v.key === vKey)?.price ?? 0);
  }
  return sum;
}
