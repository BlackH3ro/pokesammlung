import { requireOptionalNativeModule } from 'expo';
import { fetchCardRaw, getCard, loadSeries, SetBrief } from './api';
import { CardIndex, numberKey } from './cardIndex';
import type { Lang } from './collection';
import type { ImageHit } from './LiveCamera';
import type { Card } from './api';

export type Match = { card: Card; setId: string; setName: string; confident: boolean };

// ---- OCR on the device (Apple Vision, see modules/text-recognizer) ----

const native = requireOptionalNativeModule<{ recognize(uri: string): Promise<string> }>('TextRecognizer');

// Missing on the web and in builds without the native module; then the scanner falls back to OCR.space.
export const hasOnDeviceOcr = !!native;
export const ocrOnDevice = (uri: string) => native!.recognize(uri);

// ---- OCR (ocr.space, free tier) ----

export async function ocr(base64Jpeg: string, apiKey: string): Promise<string> {
  const body = new FormData();
  body.append('apikey', apiKey || 'helloworld');
  body.append('base64Image', 'data:image/jpeg;base64,' + base64Jpeg);
  body.append('OCREngine', '2');
  body.append('scale', 'true');
  const res = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    const detail = json?.ErrorMessage ? ': ' + [].concat(json.ErrorMessage).join(' ') : '';
    throw new Error(`Texterkennung fehlgeschlagen (HTTP ${res.status})${detail}`);
  }
  if (json.IsErroredOnProcessing) {
    const msg = Array.isArray(json.ErrorMessage) ? json.ErrorMessage.join(' ') : String(json.ErrorMessage ?? '');
    throw new Error(msg || 'Texterkennung fehlgeschlagen');
  }
  return (json.ParsedResults ?? []).map((r: any) => r.ParsedText ?? '').join('\n');
}

// ---- Parsing ----

export type Parsed = { number: string; total: string; prefix: string } | null;

// Finds the collector number, e.g. "4/102", "025/165", "TG05/TG30", "SV049/SV094".
export function parseNumber(text: string): Parsed {
  // Prefix letters must be glued to the digits ("TG05"), otherwise "KATO 002/128" would read as prefix "ATO".
  const re = /(?:^|[^A-Z0-9])([A-Z]{0,3})(\d{1,3}) ?\/ ?([A-Z]{0,3})(\d{2,3})/gm;
  let found: Parsed = null;
  for (const m of text.toUpperCase().replace(/[Oo](?=\d)/g, '0').matchAll(re)) {
    found = { prefix: m[1], number: m[2], total: m[4] };
  }
  return found;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Does the OCR text contain the card's name (or at least its first real word)?
function nameScore(text: string, name?: string): number {
  if (!name) return 0;
  const t = ' ' + norm(text) + ' ';
  const n = norm(name);
  if (!n) return 0;
  if (t.includes(' ' + n + ' ')) return 2;
  const first = n.split(' ').find((w) => w.length >= 3);
  return first && t.includes(' ' + first) ? 1 : 0;
}

let setIndex: Promise<SetBrief[]> | null = null;
function allSets() {
  setIndex ??= loadSeries().then((series) => series.flatMap((s) => s.sets));
  return setIndex;
}

function localIdCandidates(prefix: string, number: string) {
  const n = String(parseInt(number, 10));
  const ids = new Set([prefix + number, prefix + n, prefix + n.padStart(2, '0'), prefix + n.padStart(3, '0')]);
  return [...ids];
}

// Turns OCR text into a card. Number + printed total narrow down the set; the name picks the right one.
export async function matchCard(text: string): Promise<Match | null> {
  const parsed = parseNumber(text);
  if (!parsed) return null;
  const total = parseInt(parsed.total, 10);
  const candidates = (await allSets())
    .filter((s) => (s.printed ?? s.official) === total || (!!parsed.prefix && s.total >= total))
    .slice(0, 40);

  // Ask all candidate sets at once – one after the other took seconds with many sets of the same size.
  const hits = await Promise.all(
    candidates.map(async (set) => {
      for (const lid of localIdCandidates(parsed.prefix, parsed.number)) {
        const id = `${set.id}-${lid}`;
        const [de, en] = await Promise.all([fetchCardRaw(id, 'de'), fetchCardRaw(id, 'en')]);
        if (!de && !en) continue;
        return { id, score: Math.max(nameScore(text, de?.name), nameScore(text, en?.name)) };
      }
      return null;
    }),
  );
  let best: { id: string; score: number } | null = null;
  for (const hit of hits) if (hit && (!best || hit.score > best.score)) best = hit;
  if (!best) return null;
  // Without a name hit we only trust the number if exactly one set fits.
  const confident = best.score > 0 || candidates.length === 1;
  const res = await getCard(best.id);
  return res ? { card: res.card, setId: res.setId, setName: res.setName, confident } : null;
}

// ---- Set-locked mode (Cardslinger with a stack from one set) ----

const enNames = new Map<string, Promise<Map<string, string>>>();

// English names of a set's cards (incl. merged sub-sets), so English cards match too.
function englishNames(setId: string, cardIds: string[]) {
  if (!enNames.has(setId)) {
    const subSets = [...new Set(cardIds.map((id) => id.replace(/-[^-]+$/, '')))];
    enNames.set(
      setId,
      Promise.all(
        subSets.map((s) =>
          fetch('https://api.tcgdex.net/v2/en/sets/' + encodeURIComponent(s))
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ),
      ).then((sets) => {
        const m = new Map<string, string>();
        for (const s of sets) for (const c of s?.cards ?? []) m.set(c.id, c.name);
        return m;
      }),
    );
  }
  return enNames.get(setId)!;
}

const bareNumber = (lid: string) => lid.replace(/^[A-Za-z]+\s*/, '').replace(/^0+(?=\d)/, '');

// Matches only against one set: by number where it fits, otherwise by name (e.g. Classic Collection
// reprints, which carry their original number).
export async function matchCardInSet(text: string, set: { id: string; name: string; cards: Card[] }): Promise<Match | null> {
  const parsed = parseNumber(text);
  const en = await englishNames(set.id, set.cards.map((c) => c.id));
  const scored = set.cards.map((card) => {
    const name = Math.max(nameScore(text, card.name), nameScore(text, en.get(card.id)));
    const num = parsed ? bareNumber(card.localId) === bareNumber(parsed.prefix + parsed.number) : false;
    return { card, score: name * 2 + (num ? 3 : 0), name, num };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score === 0) return null;
  // Number alone or a partial name is a guess; number + name or a unique full name is solid.
  const sameName = scored.filter((s) => s.name === 2).length;
  const confident = (best.num && best.name > 0) || (best.name === 2 && sameName === 1);
  return { card: best.card, setId: set.id, setName: set.name, confident };
}

// ---- Live mode: match one video frame's text against the local card index ----

export type LiveHit = { id: string; confident: boolean; candidates: string[] };

export function matchLive(text: string, idx: CardIndex): LiveHit | null {
  const parsed = parseNumber(text);
  if (!parsed) return null;
  const total = parseInt(parsed.total, 10);
  const all = idx.byNumber.get(numberKey(parsed.prefix, parsed.number)) ?? [];
  // Plain numbers must fit the printed total ("025/165"); prefixed ones (TG05/TG30) have their own count.
  const candidates = parsed.prefix ? all : all.filter((c) => idx.printed.get(c.setId) === total);
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const score = Math.max(nameScore(text, c.de), nameScore(text, c.en));
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return { id: best.id, confident: bestScore > 0 || candidates.length === 1, candidates: candidates.map((c) => c.id) };
}

// ---- Card language from the printed words (HP/KP, Weakness/Schwäche …) ----

const LANG_WORDS: [Lang, RegExp][] = [
  ['de', /\b(KP|Schwäche|Schwache|Resistenz|Rückzug|Ruckzug|Fähigkeit|Fahigkeit|Entwickelt|Basis|Phase)\b/gi],
  ['en', /\b(HP|Weakness|Resistance|Retreat|Ability|Evolves|Basic|Stage)\b/gi],
  ['fr', /\b(PV|Faiblesse|Résistance|Resistance|Retraite|Talent|Évolue|Evolue|Base|Niveau)\b/gi],
  ['it', /\b(PS|Debolezza|Resistenza|Ritirata|Abilità|Abilita|Si evolve|Base|Fase)\b/gi],
  ['es', /\b(PS|Debilidad|Resistencia|Retirada|Habilidad|Evoluciona|Básico|Basico|Fase)\b/gi],
  ['pt', /\b(PS|Fraqueza|Resistência|Resistencia|Recuo|Habilidade|Evolui|Básico|Basico|Estágio)\b/gi],
];

// Best guess of the card's language, or null when the text gives no hint.
export function detectLang(text: string): Lang | null {
  if (/[぀-ヿ一-龯]/.test(text)) return 'ja';
  let best: Lang | null = null;
  let bestHits = 0;
  for (const [lang, re] of LANG_WORDS) {
    const hits = text.match(re)?.length ?? 0;
    if (hits > bestHits) {
      best = lang;
      bestHits = hits;
    }
  }
  return best;
}

// ---- Combining the text with the picture comparison ----


// The picture decides when the number leaves several cards open (e.g. same number in two sets),
// and stands in for the text when no number is readable (glare on full arts, sleeves …).
export function combineHits(text: LiveHit | null, image: ImageHit[] | undefined, known: (id: string) => boolean): LiveHit | null {
  const top = (image ?? []).filter((h) => known(h.id));
  if (text) {
    if (text.confident || !top.length) return text;
    const pick = top.find((h) => text.candidates.includes(h.id));
    return pick ? { ...text, id: pick.id, confident: true } : text;
  }
  // Picture only: the best match has to stand out clearly from the runner-up.
  if (top.length && top[0].score >= 0.6 && (top.length === 1 || top[0].score - top[1].score >= 0.04)) {
    return { id: top[0].id, confident: false, candidates: [top[0].id] };
  }
  return null;
}
