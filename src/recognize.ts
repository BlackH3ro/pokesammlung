import { fetchCardRaw, getCard, loadSeries, SetBrief } from './api';
import type { Card } from './api';

export type Match = { card: Card; setId: string; setName: string; confident: boolean };

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

  let best: { id: string; score: number } | null = null;
  for (const set of candidates) {
    for (const lid of localIdCandidates(parsed.prefix, parsed.number)) {
      const id = `${set.id}-${lid}`;
      const [de, en] = await Promise.all([fetchCardRaw(id, 'de'), fetchCardRaw(id, 'en')]);
      if (!de && !en) continue;
      const score = Math.max(nameScore(text, de?.name), nameScore(text, en?.name));
      if (!best || score > best.score) best = { id, score };
      break;
    }
    if (best && best.score === 2) break;
  }
  if (!best) return null;
  // Without a name hit we only trust the number if exactly one set fits.
  const confident = best.score > 0 || candidates.length === 1;
  const res = await getCard(best.id);
  return res ? { card: res.card, setId: res.setId, setName: res.setName, confident } : null;
}
