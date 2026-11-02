import type { Slab, SlabPrice } from './collection';
import type { Settings } from './settings';

// Slab market value from current eBay listings (Browse API, free developer keys).
// Active fixed-price listings on eBay.de, filtered to the exact grader + grade, median in EUR.

export const COMPANIES = ['PSA', 'BGS', 'CGC', 'TAG', 'SGC', 'ACE', 'PCA', 'GMA', 'AP'];
export const GRADES = ['10', '9.5', '9', '8.5', '8', '7', '6', '5', '4', '3', '2', '1'];
export const LANGUAGES: { id: string; label: string; keyword: string }[] = [
  { id: 'en', label: 'Englisch', keyword: '' },
  { id: 'de', label: 'Deutsch', keyword: 'deutsch' },
  { id: 'ja', label: 'Japanisch', keyword: 'japanese' },
  { id: 'fr', label: 'Französisch', keyword: 'french' },
  { id: 'it', label: 'Italienisch', keyword: 'italian' },
  { id: 'es', label: 'Spanisch', keyword: 'spanish' },
  { id: 'pt', label: 'Portugiesisch', keyword: 'portuguese' },
  { id: 'ko', label: 'Koreanisch', keyword: 'korean' },
  { id: 'zh', label: 'Chinesisch', keyword: 'chinese' },
];

let token: { value: string; until: number; id: string } | null = null;

function b64(s: string) {
  // btoa exists in Hermes and browsers.
  return globalThis.btoa(s);
}

async function getToken(s: Settings) {
  if (token && token.id === s.ebayClientId && Date.now() < token.until) return token.value;
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + b64(`${s.ebayClientId}:${s.ebayClientSecret}`),
    },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) throw new Error('eBay-Anmeldung fehlgeschlagen – App ID / Cert ID prüfen');
  token = { value: json.access_token, until: Date.now() + (json.expires_in - 120) * 1000, id: s.ebayClientId };
  return token.value;
}

const rates: Record<string, { value: number; at: number }> = {};
async function toEur(value: number, currency: string) {
  if (currency === 'EUR') return value;
  const hit = rates[currency];
  if (!hit || Date.now() - hit.at > 12 * 3600e3) {
    const r = await fetch(`https://api.frankfurter.dev/v1/latest?from=${currency}&to=EUR`).then((x) => x.json());
    if (!r?.rates?.EUR) throw new Error('Wechselkurs nicht verfügbar');
    rates[currency] = { value: r.rates.EUR, at: Date.now() };
  }
  return value * rates[currency].value;
}

const BAD = /\b(lot|bundle|proxy|custom|replica|case only|leer|empty|sticker|label only|fake|reprint)\b/i;

function titleFits(title: string, slab: Slab) {
  const t = title.toUpperCase();
  if (BAD.test(title)) return false;
  if (!t.includes(slab.company.toUpperCase())) return false;
  // Grade must stand alone ("PSA 10", "BGS 9.5"), so "PSA 9" doesn't match "PSA 10" listings.
  const g = slab.grade.replace('.', '\\.');
  return new RegExp(`(^|[^0-9.])${g}([^0-9.]|$)`).test(t);
}

function median(xs: number[]) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function search(q: string, marketplace: string, tok: string) {
  const url =
    'https://api.ebay.com/buy/browse/v1/item_summary/search?limit=100&filter=' +
    encodeURIComponent('buyingOptions:{FIXED_PRICE}') +
    '&q=' +
    encodeURIComponent(q);
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + tok, 'X-EBAY-C-MARKETPLACE-ID': marketplace } });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.errors?.[0]?.message ?? `eBay-Fehler ${res.status}`);
  return (json?.itemSummaries ?? []) as { title: string; price?: { value: string; currency: string } }[];
}

export function slabQueries(slab: Slab): string[] {
  const lang = LANGUAGES.find((l) => l.id === slab.language)?.keyword ?? '';
  const name = slab.language === 'de' ? slab.name : slab.nameEn || slab.name;
  const num = slab.number.replace(/^KS\s*/, '');
  const base = `${slab.company} ${slab.grade} ${name}`;
  return [`${base} ${num} ${lang}`, `${base} ${lang}`].map((q) => q.replace(/\s+/g, ' ').trim());
}

export function ebayUrl(slab: Slab) {
  return 'https://www.ebay.de/sch/i.html?_nkw=' + encodeURIComponent(slabQueries(slab)[0]);
}

export const SEALED_KINDS = ['Display', 'Elite-Trainer-Box', 'Booster', 'Sleeved Booster', 'Collection Box', 'Tin', 'Blister', 'Bundle', 'Sonstiges'];

// eBay search words per kind (German and English listings).
const KIND_WORDS: Record<string, string> = {
  Display: 'display',
  'Elite-Trainer-Box': 'elite trainer box',
  Booster: 'booster',
  'Sleeved Booster': 'sleeved booster',
  'Collection Box': 'collection box',
  Tin: 'tin',
  Blister: 'blister',
  Bundle: 'booster bundle',
  Sonstiges: '',
};

const SEALED_BAD = /\b(leer|empty|code|codes|karte|card|single|einzel|nur|only|ohne|without|opened|geöffnet|offen|proxy|fake|case)\b/i;

export function sealedQuery(item: { name: string; kind: string; language: string }) {
  const lang = LANGUAGES.find((l) => l.id === item.language)?.keyword ?? '';
  const kind = KIND_WORDS[item.kind] ?? '';
  const name = item.name.toLowerCase().includes(kind.split(' ')[0]) ? item.name : `${item.name} ${kind}`;
  return `pokemon ${name} ${lang}`.replace(/\s+/g, ' ').trim();
}

export const sealedEbayUrl = (item: { name: string; kind: string; language: string }) =>
  'https://www.ebay.de/sch/i.html?_nkw=' + encodeURIComponent(sealedQuery(item));

// Median of current fixed-price listings for a sealed product, in EUR.
export async function fetchSealedPrice(item: { name: string; kind: string; language: string }, settings: Settings): Promise<SlabPrice> {
  if (!settings.ebayClientId || !settings.ebayClientSecret) throw new Error('Für Preise fehlen die eBay-Schlüssel (Einstellungen)');
  const tok = await getToken(settings);
  const q = sealedQuery(item);
  const words = item.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  for (const market of ['EBAY_DE', 'EBAY_US']) {
    const items = (await search(q, market, tok)).filter(
      (i) => i.price && !SEALED_BAD.test(i.title) && words.every((w) => i.title.toLowerCase().includes(w)),
    );
    if (items.length >= 2) {
      const prices = await Promise.all(items.map((i) => toEur(parseFloat(i.price!.value), i.price!.currency)));
      return { value: Math.round(median(prices) * 100) / 100, n: prices.length, at: Date.now(), query: `${q} (${market})` };
    }
  }
  throw new Error('Keine passenden Angebote gefunden – Namen kürzer fassen oder eigenen Wert eintragen');
}

export async function fetchSlabPrice(slab: Slab, settings: Settings): Promise<SlabPrice> {
  if (!settings.ebayClientId || !settings.ebayClientSecret) {
    throw new Error('Für Slab-Preise fehlen die eBay-Schlüssel (Einstellungen)');
  }
  const tok = await getToken(settings);
  for (const q of slabQueries(slab)) {
    // eBay.de first (EUR); fall back to eBay.com for rarer slabs.
    for (const market of ['EBAY_DE', 'EBAY_US']) {
      const items = (await search(q, market, tok)).filter((i) => i.price && titleFits(i.title, slab));
      if (items.length >= 2) {
        const prices = await Promise.all(items.map((i) => toEur(parseFloat(i.price!.value), i.price!.currency)));
        return { value: Math.round(median(prices) * 100) / 100, n: prices.length, at: Date.now(), query: `${q} (${market})` };
      }
    }
  }
  throw new Error('Keine passenden Angebote gefunden');
}
