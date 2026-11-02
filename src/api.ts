import AsyncStorage from '@react-native-async-storage/async-storage';

// Free, keyless API with German card names and Cardmarket (EUR) prices.
const BASE = 'https://api.tcgdex.net/v2/de';
const DAY = 24 * 60 * 60 * 1000;

export type SetBrief = {
  id: string;
  name: string;
  logo?: string;
  logoEn?: string; // English logo, used when the German one is missing
  symbol?: string;
  official: number;
  total: number;
  printed?: number; // count printed on the cards (official stays printed even after merging sub-sets)
};

export type Series = {
  id: string;
  name: string;
  releaseDate: string;
  sets: SetBrief[];
};

// One collectable version of a card (e.g. normal, reverse holo, stamped).
export type Variant = {
  key: string;
  label: string;
  price: number | null;
  avg30?: number | null; // 30-day average, for trend arrows
};

export type Card = {
  id: string;
  localId: string;
  name: string;
  rarity: string;
  image?: string;
  variants: Variant[];
};

export type SetDetail = SetBrief & {
  releaseDate?: string;
  cards: Card[];
  fetchedAt: number;
};

async function getJson(path: string) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${path}`);
  return res.json();
}

async function cached<T>(key: string, maxAge: number, load: () => Promise<T>, force = false): Promise<T> {
  if (!force) {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const hit = JSON.parse(raw) as { at: number; data: T };
        if (Date.now() - hit.at < maxAge) return hit.data;
      }
    } catch {}
  }
  const data = await load();
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {}
  return data;
}

export async function readCachedSet(id: string): Promise<SetDetail | null> {
  try {
    const raw = await AsyncStorage.getItem('setv4:' + id);
    return raw ? (JSON.parse(raw).data as SetDetail) : null;
  } catch {
    return null;
  }
}

function toBrief(s: any, seriesId?: string): SetBrief {
  return {
    id: s.id,
    name: s.name,
    logo: s.logo,
    logoEn: seriesId ? `https://assets.tcgdex.net/en/${seriesId}/${s.id}/logo` : undefined,
    symbol: s.symbol,
    official: s.cardCount?.official ?? 0,
    total: s.cardCount?.total ?? 0,
    printed: s.cardCount?.official ?? 0,
  };
}

// Sub-sets shown inside their main set: child id -> [parent id, number prefix].
const MERGED: Record<string, [string, string]> = {
  '30th-c': ['30th', 'KS '],
};

function mergeSets(sets: SetBrief[]): SetBrief[] {
  return sets
    .map((s) => {
      const children = sets.filter((c) => MERGED[c.id]?.[0] === s.id);
      return children.reduce(
        (acc, c) => ({ ...acc, official: acc.official + c.official, total: acc.total + c.total }),
        s,
      );
    })
    .filter((s) => !MERGED[s.id] || !sets.some((p) => p.id === MERGED[s.id][0]));
}

export const isMergedChild = (id: string) => !!MERGED[id];

export function loadSeries(force = false): Promise<Series[]> {
  return cached('series:v4', 7 * DAY, async () => {
    // TCG Pocket is a digital-only game, no physical cards to collect.
    const list: any[] = (await getJson('/series')).filter((s: any) => s.id !== 'tcgp');
    const details = await mapLimit(list, 6, (s) => getJson('/series/' + encodeURIComponent(s.id)).catch(() => null));
    return details
      .filter(Boolean)
      .map((d: any) => ({
        id: d.id,
        name: d.name,
        releaseDate: d.releaseDate ?? '',
        sets: mergeSets((d.sets ?? []).map((s: any) => toBrief(s, d.id)).filter((s: SetBrief) => s.total > 0)).reverse(),
      }))
      .filter((s) => s.sets.length > 0)
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  }, force);
}

function pickAvg30(type: string, cm: any): number | null {
  if (!cm) return null;
  const v = /reverse/i.test(type) ? cm['avg30-holo'] : cm.avg30;
  return typeof v === 'number' && v > 0 ? v : null;
}

function pickPrice(type: string, cm: any): number | null {
  if (!cm) return null;
  const v = /reverse/i.test(type)
    ? cm['trend-holo'] || cm['avg-holo'] || cm['avg30-holo']
    : cm.trend || cm.avg || cm.avg30;
  return typeof v === 'number' && v > 0 ? v : null;
}

const TYPE_LABEL: Record<string, string> = {
  normal: 'Normal',
  reverse: 'Reverse Holo',
  holo: 'Holo',
  firstedition: '1. Edition',
  wpromo: 'Promo',
};

function label(type: string) {
  return TYPE_LABEL[type.toLowerCase()] ?? type;
}

function stampLabel(stamp: string) {
  if (!stamp) return '';
  if (/30th-anniversary/i.test(stamp)) return '30-Jahre-Stempel';
  return stamp.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) + '-Stempel';
}

function toCard(c: any): Card {
  const fallback = c.pricing?.cardmarket;
  let variants: Variant[] = [];
  if (Array.isArray(c.variants_detailed) && c.variants_detailed.length) {
    const seen = new Set<string>();
    for (const v of c.variants_detailed) {
      const stamp = Array.isArray(v.stamp) && v.stamp.length ? v.stamp.join(', ') : '';
      const extra = [stampLabel(stamp), v.size && v.size.toLowerCase() !== 'standard' ? v.size : ''].filter(Boolean).join(', ');
      let key = [v.type, stamp, v.size].filter(Boolean).join('/').toLowerCase();
      while (seen.has(key)) key += '+';
      seen.add(key);
      variants.push({
        key,
        label: label(v.type) + (extra ? ` (${extra})` : ''),
        price: pickPrice(v.type, v.pricing?.cardmarket ?? fallback),
        avg30: pickAvg30(v.type, v.pricing?.cardmarket ?? fallback),
      });
    }
  } else if (c.variants) {
    for (const type of ['normal', 'holo', 'reverse', 'firstEdition']) {
      if (c.variants[type]) variants.push({ key: type.toLowerCase(), label: label(type), price: pickPrice(type, fallback), avg30: pickAvg30(type, fallback) });
    }
  }
  if (!variants.length) variants = [{ key: 'normal', label: 'Normal', price: pickPrice('normal', fallback) }];
  // Normal first, reverse after, everything else in API order.
  const rank = (v: Variant) => (v.key.startsWith('normal') || v.key.startsWith('holo') ? 0 : v.key.startsWith('reverse') ? 1 : 2);
  variants.sort((a, b) => rank(a) - rank(b));
  return {
    id: c.id,
    localId: c.localId,
    name: c.name,
    rarity: c.rarity && c.rarity !== 'Keine' ? c.rarity : '',
    image: c.image,
    variants,
  };
}

export function loadSet(id: string, force = false, onProgress?: (done: number, total: number) => void): Promise<SetDetail> {
  return cached('setv4:' + id, DAY, async () => {
    const s = await getJson('/sets/' + encodeURIComponent(id));
    const children = Object.keys(MERGED).filter((c) => MERGED[c][0] === id);
    const extra = await Promise.all(children.map((c) => getJson('/sets/' + encodeURIComponent(c))));
    const prefix: Record<string, string> = {};
    for (const c of extra) for (const b of c.cards ?? []) prefix[b.id] = MERGED[c.id][1];
    const briefs: any[] = [...(s.cards ?? []), ...extra.flatMap((c) => c.cards ?? [])];
    let done = 0;
    const cards = await mapLimit(briefs, 8, async (b) => {
      const full = await getJson('/cards/' + encodeURIComponent(b.id)).catch(() => b);
      if (!full.image) {
        // German scans are sometimes missing; fall back to the English one.
        const en = await fetch(BASE.replace('/de', '/en') + '/cards/' + encodeURIComponent(b.id))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (en?.image) full.image = en.image;
      }
      onProgress?.(++done, briefs.length);
      const card = toCard(full);
      if (prefix[b.id]) card.localId = prefix[b.id] + card.localId;
      return card;
    });
    const brief = toBrief(s);
    for (const c of extra) {
      brief.official += c.cardCount?.official ?? 0;
      brief.total += c.cardCount?.total ?? 0;
    }
    return { ...brief, releaseDate: s.releaseDate, cards, fetchedAt: Date.now() };
  }, force);
}

// Sets TCGdex has no scans for; Pokellector does (English). Values are '<folder>/<file>' without extension.
const PKL = 'https://den-cards.pokellector.com/';
const EXTRA_IMAGES: Record<string, string> = {
  '30th-c-001': '439/Charizard-Base-Set.30CCC.4.62193',
  '30th-c-002': '439/Delcatty-EX-Ruby-Sapphire.30CCC.5.62199',
  '30th-c-003': '439/Metagross-EX-Delta-Species.30CCC.11.62202',
  '30th-c-004': '439/Genesect-EX-Plasma-Blast.30CCC.11.62211',
  '30th-c-005': '439/Misty-Gym-Heroes.30CCC.18.62194',
  '30th-c-006': '439/Dark-Tyranitar-EX-Team-Rocket-Returns.30CCC.19.62200',
  '30th-c-007': '439/Sneasel-Neo-Genesis.30CCC.25.62196',
  '30th-c-008': '439/Pikachu-Zekrom-GX-Team-Up.30CCC.33.62216',
  '30th-c-009': '439/Greninja-BREAK-BREAKpoint.30CCC.41.62213',
  '30th-c-010': '439/Uxie-Legends-Awakened.30CCC.43.62204',
  '30th-c-011': '439/Crobat-Platinum.30CCC.47.62205',
  '30th-c-012': '439/Raikou-Vivid-Voltage.30CCC.50.62218',
  '30th-c-013': '439/Buzzwole-GX-Crimson-Invasion.30CCC.57.62215',
  '30th-c-014': '439/Pikachu-Base-Set.30CCC.58.62192',
  '30th-c-015': '439/Erikas-Jigglypuff-Gym-Challenge.30CCC.69.62195',
  '30th-c-016': '439/Rayquaza-EX-Dragons-Exalted.30CCC.85.62210',
  '30th-c-017': '439/Solgaleo-GX-Sun-Moon.30CCC.89.62214',
  '30th-c-018': '439/Gengar-Triumphant.30CCC.94.62206',
  '30th-c-019': '439/Darkrai-Cresselia-Triumphant.30CCC.99.62207',
  '30th-c-020': '439/Darkrai-Cresselia-Triumphant.30CCC.100.62208',
  '30th-c-021': '439/N-Noble-Victories.30CCC.101.62209',
  '30th-c-022': '439/Palkia-LV-X-Great-Encounters.30CCC.106.62203',
  '30th-c-023': '439/M-Gardevoir-EX-Primal-Clash.30CCC.106.62212',
  '30th-c-024': '439/Shining-Celebi-Neo-Destiny.30CCC.106.62197',
  '30th-c-025': '439/Scizor-ex-EX-Unseen-Forces.30CCC.108.62201',
  '30th-c-026': '439/Mew-VMAX-Fusion-Strike.30CCC.114.62219',
  '30th-c-027': '439/Arceus-VSTAR-Brilliant-Stars.30CCC.123.62220',
  '30th-c-028': '439/Zacian-V-Sword-Shield.30CCC.138.62217',
  '30th-c-029': '439/Lugia-Aquapolis.30CCC.149.62198',
  '30th-c-030': '439/Magikarp-Paldea-Evolved.30CCC.203.62221',
  // Celebrations Classic Collection (TCGdex has no scans).
  'cel25cc-CC001': '119/Blastoise.BS.2.40564',
  'cel25cc-CC002': '119/Charizard.BS.4.40566',
  'cel25cc-CC003': '119/Venusaur.BS.15.40565',
  'cel25cc-CC004': '119/Imposter-Professor-Oak.BS.73.40587',
  'cel25cc-CC005': '123/Dark-Gyarados.TR.8.40588',
  'cel25cc-CC006': '123/Here-Comes-Team-Rocket.TR.15.40589',
  'cel25cc-CC007': '118/Rockets-Zapdos.G2.15.40590',
  'cel25cc-CC008': '125/___s-Pikachu.WOTC.24.40591',
  'cel25cc-CC009': '113/Cleffa.N1.20.40592',
  'cel25cc-CC010': '115/Shining-Magikarp.N3.66.40593',
  'cel25cc-CC011': '55/Team-Magmas-Groudon.MA.9.40594',
  'cel25cc-CC012': '58/Rockets-Admin.RR.86.40595',
  'cel25cc-CC013': '63/Mew-ex.LM.88.40596',
  'cel25cc-CC014': '66/Gardevoir-ex-delta-species.DF.93.40598',
  'cel25cc-CC015': '102/Umbreon-.POP5.17.40597',
  'cel25cc-CC016': '45/Claydol.GE.15.40599',
  'cel25cc-CC017': '39/Luxray-GL-LV-X.RR.109.40600',
  'cel25cc-CC018': '40/Garchomp-C-LV-X.SV.145.40601',
  'cel25cc-CC019': '34/Donphan.HGSS.107.40602',
  'cel25cc-CC020': '1/Reshiram.BLW.113.40603',
  'cel25cc-CC021': '1/Zekrom.BLW.114.40604',
  'cel25cc-CC022': '5/Mewtwo-EX.NXD.54.40605',
  'cel25cc-CC023': '142/Xerneas-EX.XY.97.40606',
  'cel25cc-CC024': '169/M-Rayquaza-EX.ROS.76.40607',
  'cel25cc-CC025': '220/Tapu-Lele-GX.GRI.60.40608',
};

export function imageUrl(card: Card, quality: 'low' | 'high' = 'low') {
  const extra = EXTRA_IMAGES[card.id];
  if (extra) return PKL + extra + (quality === 'low' ? '.thumb.png' : '.png');
  return card.image ? `${card.image}/${quality}.png` : undefined;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Merged sub-sets (e.g. Classic Collection) belong to their parent set in the app.
export function parentSet(id: string) {
  return MERGED[id]?.[0] ?? id;
}

const cardCache = new Map<string, Promise<any | null>>();
const parentCache = new Map<string, Promise<any | null>>();
const parentSetInfo = (id: string) => {
  if (!parentCache.has(id)) parentCache.set(id, getJson('/sets/' + encodeURIComponent(id)).catch(() => null));
  return parentCache.get(id)!;
};

// Raw card JSON in the given language, or null if it doesn't exist.
export function fetchCardRaw(id: string, lang: 'de' | 'en' = 'de'): Promise<any | null> {
  const k = lang + ':' + id;
  if (!cardCache.has(k)) {
    const base = lang === 'de' ? BASE : BASE.replace('/de', '/en');
    cardCache.set(
      k,
      fetch(base + '/cards/' + encodeURIComponent(id))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return cardCache.get(k)!;
}

export async function getCard(id: string): Promise<{ card: Card; setId: string; setName: string; nameEn?: string } | null> {
  const [de, en] = await Promise.all([fetchCardRaw(id, 'de'), fetchCardRaw(id, 'en')]);
  const raw = de ?? en;
  if (!raw) return null;
  if (!raw.image && en?.image) raw.image = en.image;
  const card = toCard(raw);
  const setId = parentSet(raw.set?.id ?? id.replace(/-[^-]+$/, ''));
  let setName = raw.set?.name ?? '';
  if (setId !== raw.set?.id) {
    const parent = await parentSetInfo(setId);
    if (parent?.name) setName = parent.name;
    if (MERGED[raw.set.id]) card.localId = MERGED[raw.set.id][1] + card.localId;
  }
  return { card, setId, setName, nameEn: en?.name };
}

export type CardHit = { id: string; localId: string; name: string; image?: string; thumbs: string[] };

// Name search in German and English, merged and de-duplicated.
export async function searchCards(q: string): Promise<CardHit[]> {
  const query = encodeURIComponent(q.trim());
  if (!query) return [];
  const [de, en] = await Promise.all(
    [BASE, BASE.replace('/de', '/en')].map((b) =>
      fetch(`${b}/cards?name=like:${query}&pagination:itemsPerPage=60`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ),
  );
  const seen = new Map<string, CardHit>();
  for (const c of [...de, ...en]) {
    const prev = seen.get(c.id);
    if (!prev) seen.set(c.id, c);
    else if (!prev.image && c.image) prev.image = c.image;
  }
  // Candidate thumbnails: special sources, German scan, English scan, English scan built from the set's series.
  const series = await loadSeries().catch(() => [] as Series[]);
  const seriesOf = new Map<string, string>();
  for (const se of series) for (const st of se.sets) seriesOf.set(st.id, se.id);
  for (const id of Object.keys(MERGED)) seriesOf.set(id, seriesOf.get(MERGED[id][0]) ?? '');
  return [...seen.values()].map((c) => {
    const setId = c.id.slice(0, c.id.length - c.localId.length - 1);
    const serie = seriesOf.get(setId);
    const thumbs = cardImages(c);
    // No scan listed at all: try the English asset path built from the set's series, before external hosts.
    if (serie && !c.image) thumbs.splice(externalImage(c.id, 'low') ? thumbs.length - 1 : thumbs.length, 0, `https://assets.tcgdex.net/en/${serie}/${setId}/${c.localId}/low.png`);
    return { ...c, thumbs };
  });
}

// Sets where TCGdex has no scans: pokemontcg.io / Scrydex have them under their own set ids.
// strip = drop leading zeros of the number ("001" -> "1"). Verified per set against both hosts.
const EXTERNAL: Record<string, { host: 'ptcg' | 'scrydex'; id: string; strip?: boolean }> = {
  ecard2: { host: 'ptcg', id: 'ecard2' },
  ecard3: { host: 'ptcg', id: 'ecard3', strip: true },
  'tk-ex-latia': { host: 'ptcg', id: 'tk1a' },
  'tk-ex-latio': { host: 'ptcg', id: 'tk1b' },
  'tk-ex-p': { host: 'ptcg', id: 'tk2a' },
  'tk-ex-m': { host: 'ptcg', id: 'tk2b' },
  bog: { host: 'ptcg', id: 'bp' },
  exu: { host: 'ptcg', id: 'ex10' },
  pop6: { host: 'ptcg', id: 'pop6' },
  pl2: { host: 'ptcg', id: 'pl2' },
  hgssp: { host: 'ptcg', id: 'hsp' },
  bwp: { host: 'ptcg', id: 'bwp' },
  '2011bw': { host: 'ptcg', id: 'mcd11' },
  '2012bw': { host: 'ptcg', id: 'mcd12' },
  xyp: { host: 'ptcg', id: 'xyp' },
  xy8: { host: 'ptcg', id: 'xy8' },
  '2014xy': { host: 'scrydex', id: 'mcd14', strip: true },
  '2015xy': { host: 'scrydex', id: 'mcd15', strip: true },
  '2016xy': { host: 'ptcg', id: 'mcd16' },
  smp: { host: 'ptcg', id: 'smp' },
  sm2: { host: 'ptcg', id: 'sm2' },
  'sm3.5': { host: 'ptcg', id: 'sm35' },
  sm6: { host: 'ptcg', id: 'sm6' },
  'sm7.5': { host: 'ptcg', id: 'sm75' },
  '2017sm': { host: 'scrydex', id: 'mcd17', strip: true },
  '2018sm': { host: 'scrydex', id: 'mcd18', strip: true },
  '2019sm': { host: 'ptcg', id: 'mcd19' },
  swshp: { host: 'ptcg', id: 'swshp' },
  '2021swsh': { host: 'ptcg', id: 'mcd21' },
  'swsh4.5sv': { host: 'ptcg', id: 'swsh45sv' },
  cel25: { host: 'ptcg', id: 'cel25' },
  swsh9tg: { host: 'ptcg', id: 'swsh9tg' },
  swsh10tg: { host: 'ptcg', id: 'swsh10tg' },
  '2022swsh': { host: 'ptcg', id: 'mcd22' },
  swsh11tg: { host: 'ptcg', id: 'swsh11tg' },
  swsh12tg: { host: 'ptcg', id: 'swsh12tg' },
  'swsh12.5gg': { host: 'ptcg', id: 'swsh12pt5gg' },
  '2023sv': { host: 'scrydex', id: 'mcd23', strip: true },
  '2024sv': { host: 'scrydex', id: 'mcd24', strip: true },
  sve: { host: 'scrydex', id: 'sve', strip: true },
  svp: { host: 'scrydex', id: 'svp', strip: true },
  mee: { host: 'scrydex', id: 'mee', strip: true },
  mep: { host: 'scrydex', id: 'mep', strip: true },
};

function externalImage(cardId: string, quality: 'low' | 'high') {
  const setId = Object.keys(EXTERNAL).find((k) => cardId.startsWith(k + '-'));
  if (!setId) return undefined;
  const ext = EXTERNAL[setId];
  let num = cardId.slice(setId.length + 1);
  if (ext.strip) num = num.replace(/^([A-Za-z]*)0+(?=\d)/, '$1');
  return ext.host === 'ptcg'
    ? `https://images.pokemontcg.io/${ext.id}/${num}${quality === 'high' ? '_hires' : ''}.png`
    : `https://images.scrydex.com/pokemon/${ext.id}-${num}/${quality === 'high' ? 'large' : 'small'}`;
}

// Every image source for a card, best first: special scans, German, English, external hosts.
export function cardImages(card: { id: string; image?: string }, quality: 'low' | 'high' = 'low'): string[] {
  const extra = EXTRA_IMAGES[card.id];
  return [
    extra && PKL + extra + (quality === 'low' ? '.thumb.png' : '.png'),
    card.image && `${card.image}/${quality}.png`,
    card.image && `${card.image.replace('/de/', '/en/')}/${quality}.png`,
    externalImage(card.id, quality),
  ].filter((u): u is string => !!u);
}
