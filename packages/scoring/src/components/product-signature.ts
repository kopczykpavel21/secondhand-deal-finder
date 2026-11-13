/**
 * Product signature: which exact product does a query pin down, and which
 * exact product does a listing title describe?
 *
 * "iphone 13" pins the number 13 to the word "iphone". A title that says
 * "iPhone 5" or "iPhone 15 Pro" names a different model; one that says
 * "iPhone 13 mini 128GB" names the model, a variant ("mini") and a storage
 * size. The scorer uses this for two things:
 *
 *  1. Hiding other models. Token matching alone cannot do it — every iPhone
 *     title contains "iphone".
 *  2. Comparing prices like for like. A Pro Max is not expensive because it
 *     costs more than a mini.
 *
 * Everything here is positional and language-independent: no brand or model
 * lists, so it works the same for "fenix 7", "galaxy s23", "ps5", "rtx 3060"
 * or "lego 42115".
 *
 * Car searches are left alone (pass family 'vehicle'): the number after a car
 * model is an engine size or a year far more often than a generation.
 */
import { stripDiacritics, tokenize } from './relevance.js';

export type ModelMatch =
  /** the title names the pinned model ("iPhone 13 Pro" for "iphone 13") */
  | 'match'
  /** the title names another model of the same line ("iPhone 15") */
  | 'conflict'
  /** the title does not say ("Apple iPhone, top stav") */
  | 'unknown';

export interface ProductSignature {
  model: ModelMatch;
  /** Variant words after the model number, sorted: ["max", "pro"] */
  variants: string[];
  /** Storage in GB when the title states one (1 TB = 1024) */
  storageGb: number | null;
  /**
   * Like-for-like group key, or null when the title cannot be placed.
   * Pinned query: the pinned model. Unpinned query ("iphone"): the number the
   * title itself puts after the query's last word, so 13s are compared with
   * 13s and 8s with 8s.
   */
  modelKey: string | null;
}

export interface ProductMatcher {
  /** The query pins at least one model number. */
  pinned: boolean;
  /** Variant words the query itself asks for ("iphone 13 pro" → ["pro"]). */
  queryVariants: string[];
  signature(title: string): ProductSignature;
}

/** Titles say "PS5" where the query says "PlayStation 5". */
export const QUERY_ALIASES: Record<string, string[]> = {
  playstation: ['ps'],
  ps: ['playstation'],
};

/**
 * Words that follow a model number and change the price: "13 mini",
 * "Fenix 7 Sapphire Solar", "PS5 Slim Digital". Entries ending in "*" match by
 * prefix ("digitální", "digital edition").
 */
const VARIANT_WORDS = [
  'mini', 'pro', 'max', 'plus', 'ultra', 'lite', 'fe', 'slim', 'digital*', 'oled',
  'solar', 'sapphire', 'saphire', 'titanium', 'xl', 'ti', 'neo',
  // not "super": "super stav" / "super stan" is in every third title
];
/** One- and two-letter suffixes glued to the number: "7X", "A52s", "13e". */
const GLUED_SUFFIXES = new Set(['s', 'x', 'xs', 'xr', 'c', 'e', 't']);

/** A number followed by one of these is a spec ("128 gb", "8 kg"), not a model. */
const UNIT_TOKENS = new Set([
  'gb', 'tb', 'mb', 'kg', 'g', 'cm', 'mm', 'm', 'l', 'ml', 'w', 'kw', 'v', 'ks', 'kus',
  'kusy', 'kusu', 'palcu', 'palce', 'cal', 'cali', 'cale', 'zoll', 'hz', 'mah', 'mpx',
  'let', 'roky', 'rok', 'kc', 'czk', 'eur', 'zl', 'pln', 'km',
]);

const STORAGE_GB = new Set([16, 32, 64, 128, 256, 512]);
const STORAGE_TB = new Set([1, 2, 4, 8]);

const isInt = (t: string) => /^\d+$/.test(t);
/** 1950–2099: a model year or a date, never a model number. */
const isYear = (t: string) => /^(19[5-9]\d|20\d\d)$/.test(t);

/**
 * Tokenize for signature work. Decimals become the word "dec" first, so
 * "Golf 1.6 TDI" and "iPad 10.2" do not read as model numbers 1 and 10.
 */
const DECIMAL_RE = /\d+[.,]\d{1,2}(?!\d)/g;

function signatureTokens(s: string): string[] {
  return tokenize(s.replace(DECIMAL_RE, ' dec '));
}

function isVariantWord(token: string): boolean {
  return VARIANT_WORDS.some((v) =>
    v.endsWith('*') ? token.startsWith(v.slice(0, -1)) : token === v,
  );
}

interface Pin {
  /** The word the number is attached to, plus its aliases */
  anchors: string[];
  number: string;
}

/**
 * Model numbers the query pins: an integer directly after a word. Skipped:
 * numbers that carry a unit ("8 kg"), years, and numbers after a stopword
 * ("kolo do 5000") — unless the two are written as one word ("s23").
 */
function findPins(query: string, stopwords: Set<string>): { pins: Pin[]; variants: string[] } {
  const pins: Pin[] = [];
  const variants = new Set<string>();
  // Words written together in the query ("s23", "ps5", "7x") stay together.
  const words = stripDiacritics(query.toLowerCase())
    .replace(DECIMAL_RE, ' dec ')
    .split(/\s+/).filter(Boolean);

  const tokens: Array<{ t: string; glued: boolean }> = [];
  for (const word of words) {
    const parts = tokenize(word);
    const glued = parts.length > 1 && parts.some(isInt) && parts.some((p) => !isInt(p));
    for (const t of parts) tokens.push({ t, glued });
  }

  for (let i = 1; i < tokens.length; i++) {
    const { t: number } = tokens[i];
    const { t: anchor, glued } = tokens[i - 1];
    if (!isInt(number) || isInt(anchor) || anchor === 'dec' || isYear(number)) continue;
    const next = tokens[i + 1]?.t;
    if (next && UNIT_TOKENS.has(next) && !GLUED_SUFFIXES.has(next)) continue;
    if (next === 'dec') continue;
    if (stopwords.has(anchor) && !glued) continue;
    pins.push({ anchors: [anchor, ...(QUERY_ALIASES[anchor] ?? [])], number });
    // "7x", "13 pro": what follows the number in the query is the wanted variant
    if (next && tokens[i + 1].glued && GLUED_SUFFIXES.has(next)) variants.add(next);
  }
  for (const { t } of tokens) if (isVariantWord(t)) variants.add(t);
  return { pins, variants: [...variants].sort() };
}

/** Integers right after position `at`, years left out. Stops at the first word. */
function numberRun(tokens: string[], at: number): { run: string[]; end: number } {
  const run: string[] = [];
  let i = at + 1;
  for (; i < tokens.length && isInt(tokens[i]) && run.length < 4; i++) {
    if (!isYear(tokens[i])) run.push(tokens[i]);
  }
  return { run, end: i };
}

function storageOf(title: string): number | null {
  const text = stripDiacritics(title.toLowerCase());
  let best: number | null = null;
  for (const m of text.matchAll(/(\d+)\s*(gb|tb)\b/g)) {
    const n = Number(m[1]);
    const gb = m[2] === 'tb' ? (STORAGE_TB.has(n) ? n * 1024 : null) : (STORAGE_GB.has(n) ? n : null);
    // "12GB/512GB": the larger figure is the storage, the smaller the RAM
    if (gb != null && (best == null || gb > best)) best = gb;
  }
  return best;
}

/** Variant words in the few tokens after the model number. */
function variantsAfter(tokens: string[], numberAt: number, runEnd: number, rawTitle: string): string[] {
  const found = new Set<string>();
  const number = tokens[numberAt];
  const suffix = tokens[runEnd];
  if (suffix && GLUED_SUFFIXES.has(suffix) && runEnd === numberAt + 1) {
    // only when written as one word ("7x", "a52s") — "13 s krabicí" is "with box"
    const raw = stripDiacritics(rawTitle.toLowerCase());
    const glued = new RegExp(`(^|[^0-9])${number}${suffix === 'x' ? '\\s?' : ''}${suffix}(?![a-z])`);
    if (glued.test(raw)) found.add(suffix);
  }
  // "S23+", "iPhone 14+": a plus sign written straight after the number.
  // "PS5 + 2 ovladače" has a space before it, "5+2" a digit after it.
  if (new RegExp(`(^|[^0-9])${number}\\+(?![0-9])`).test(rawTitle)) found.add('plus');
  for (let i = runEnd; i < Math.min(tokens.length, runEnd + 5); i++) {
    const t = tokens[i];
    if (!isVariantWord(t)) continue;
    const stem = VARIANT_WORDS.find((v) => v.endsWith('*') && t.startsWith(v.slice(0, -1)));
    found.add(stem ? stem.slice(0, -1) : t === 'saphire' ? 'sapphire' : t);
  }
  return [...found].sort();
}

export function createProductMatcher(
  query: string,
  opts: { family?: 'vehicle' | 'device' | 'other'; stopwords?: Set<string> } = {},
): ProductMatcher {
  const none: ProductSignature = { model: 'unknown', variants: [], storageGb: null, modelKey: null };
  if (opts.family === 'vehicle') {
    return { pinned: false, queryVariants: [], signature: () => none };
  }

  const { pins, variants: queryVariants } = findPins(query, opts.stopwords ?? new Set());
  const queryTokens = signatureTokens(query).filter((t) => t !== 'dec');
  // For an unpinned query the title's own number after the query's last word
  // is the grouping key ("iphone" → "iPhone 13" groups under 13).
  const lastWord = [...queryTokens].reverse().find((t) => !isInt(t) && t.length > 2);

  const matchesAnchor = (token: string, anchors: string[]) => anchors.includes(token);

  const signature = (title: string): ProductSignature => {
    const tokens = signatureTokens(title);
    const storageGb = storageOf(title);

    if (pins.length === 0) {
      if (!lastWord) return { ...none, storageGb };
      const at = tokens.indexOf(lastWord);
      if (at === -1) return { ...none, storageGb };
      const { run, end } = numberRun(tokens, at);
      if (run.length === 0) return { ...none, storageGb };
      return {
        model: 'unknown',
        variants: variantsAfter(tokens, at + 1, end, title),
        storageGb,
        modelKey: run[0],
      };
    }

    let allMatch = true;
    let conflict = false;
    let variants: string[] = [];
    for (const pin of pins) {
      let matched = false;
      let sawOther = false;
      tokens.forEach((token, at) => {
        if (matched || !matchesAnchor(token, pin.anchors)) return;
        const { run, end } = numberRun(tokens, at);
        if (run.includes(pin.number)) {
          matched = true;
          variants = variantsAfter(tokens, at + 1 + run.indexOf(pin.number), end, title);
        } else if (run.length > 0) {
          sawOther = true;
        }
      });
      if (!matched) {
        allMatch = false;
        if (sawOther) conflict = true;
      }
    }

    const model: ModelMatch = conflict ? 'conflict' : allMatch ? 'match' : 'unknown';
    return {
      model,
      variants: model === 'match' ? variants : [],
      storageGb,
      modelKey: model === 'match' ? pins.map((p) => p.number).join('+') : null,
    };
  };

  // Asked for the same title by the kind filter, the price reference and the
  // scorer — compute once per search.
  const cache = new Map<string, ProductSignature>();
  const memoized = (title: string): ProductSignature => {
    let sig = cache.get(title);
    if (!sig) cache.set(title, (sig = signature(title)));
    return sig;
  };
  return { pinned: pins.length > 0, queryVariants, signature: memoized };
}

/**
 * Prices that are typed to fill the field, not to be paid: 1, 111, 1 234,
 * 12 345, 999 999. Only meaningful together with "far below comparable
 * listings" — 123 Kč is a fair price for a book.
 */
export function isPatternPrice(price: number | null | undefined): boolean {
  if (price == null || !Number.isInteger(price) || price <= 0) return false;
  const s = String(price);
  if (/^1+$/.test(s)) return true;
  if (s.length >= 3 && '123456789'.startsWith(s)) return true;
  if (s.length >= 5 && /^9+$/.test(s)) return true;
  return false;
}
