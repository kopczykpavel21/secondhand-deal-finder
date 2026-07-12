/**
 * Relevance score: how well does the listing title/description match the query?
 *
 * Features:
 *  1. Diacritic normalisation  — "macbook" matches "MacBook" and Czech accented chars
 *  2. Query normalisation      — "iphone13" → "iphone 13", "macbook-pro" → "macbook pro"
 *  3. Czech + English stopwords stripped from query
 *  4. Short-token filter (≤ 2 chars) unless the full query is only short tokens
 *  5. Phrase proximity bonus   — all query tokens adjacent → +0.15
 *  6. Exact number matching    — "13" doesn't hit "130" or "1300"
 *  7. Title-hit bonus (20%)    — tokens found in title rather than description
 *  8. Typo tolerance           — Levenshtein ≤ 1 for tokens ≥ 5 chars
 *  9. Accessory guard          — "Kryt pro iPhone 13" / "iPhone 13 kryt" / "Remínek Apple Watch"
 *     → score capped at 0.05 when query is for the product, title is for its accessory
 */

// ─── Diacritics ───────────────────────────────────────────────────────────────

const DIACRITIC_MAP: Record<string, string> = {
  á: 'a', č: 'c', ď: 'd', é: 'e', ě: 'e', í: 'i',
  ň: 'n', ó: 'o', ř: 'r', š: 's', ť: 't', ú: 'u',
  ů: 'u', ý: 'y', ž: 'z',
};

function stripDiacritics(s: string): string {
  return s.replace(/[áčďéěíňóřšťúůýž]/g, (c) => DIACRITIC_MAP[c] ?? c);
}

// ─── Query / title normalisation ─────────────────────────────────────────────
//
// Applied before diacritic stripping and tokenising so both the query and title
// are normalised consistently.
//   "iphone13"    → "iphone 13"
//   "13pro"       → "13 pro"
//   "macbook-pro" → "macbook pro"

function normalizeInput(s: string): string {
  return s
    .replace(/([a-záčďéěíňóřšťúůýž])(\d)/gi, '$1 $2')
    .replace(/(\d)([a-záčďéěíňóřšťúůýž])/gi, '$1 $2')
    .replace(/-/g, ' ');
}

// ─── Accessory detection ─────────────────────────────────────────────────────
//
// Three patterns are detected; any one is sufficient to cap the score:
//
//  (b) Preposition pattern — "Kryt pro iPhone 13", "Pouzdro na Samsung"
//      Title starts with an accessory noun AND query tokens appear after pro/na/for.
//
//  (c) Direct-follow pattern — "Remínek Apple Watch 44mm", "Nabíječka iPhone 13"
//      Title starts with an accessory noun AND ALL query tokens follow it directly
//      (no preposition needed — common for short accessory titles).
//
//  (d) Product-then-accessory — "iPhone 13 kryt", "Apple Watch remínek"
//      Query tokens dominate the title's opening section, an accessory noun
//      appears after the last product-token match.

const DEFAULT_ACCESSORY_HEAD_NOUNS = [
  // ── Czech: cases & covers ────────────────────────────────────────────────
  'kryt', 'krytu', 'kryty', 'krytem',
  'pouzdro', 'pouzdra', 'pouzdru', 'pouzdrem',
  'obal', 'obalu', 'obaly', 'obalem',
  'knizkovka', 'knizkovky', 'knizkovku',
  'bumper', 'bumperu',
  // ── Czech: screen protection ─────────────────────────────────────────────
  'folie', 'folii', 'folia',
  'tvrzene', 'tvrzeneho', 'tvrzena',
  'sklo', 'sklicko', 'sklicka',
  'ochranne', 'ochranny', 'ochranna', 'ochrana',
  'nalepka', 'nalepky', 'nalepku',
  // ── Czech: charging ──────────────────────────────────────────────────────
  'nabijecka', 'nabijeci', 'nabijecku', 'nabijece', 'nabijec',
  'nabijeni',
  'podlozka',
  'powerbank', 'powerbanka', 'powerbanku',
  // ── Czech: cables & adapters ─────────────────────────────────────────────
  'kabel', 'kabelu', 'kabely',
  'adapter', 'adapteru', 'adaptory',
  'redukce', 'redukci',
  'konektor', 'konektoru',
  'hub',
  // ── Czech: holders / stands ──────────────────────────────────────────────
  'drzak', 'drzaku', 'drzaky',
  'stojan', 'stojanu', 'stojany',
  'podstavec', 'podstavci',
  // ── Czech: audio ────────────────────────────────────────────────────────
  'sluchatka', 'sluchatko', 'sluchatek',
  'reproduktor', 'reproduktoru', 'reproduktory',
  // ── Czech: watch straps / bands ──────────────────────────────────────────
  'reminek', 'reminku', 'reminky', 'reminkem',
  'naramek', 'naramku', 'naramky', 'naramkem',
  // ── Czech: bags / sleeves ────────────────────────────────────────────────
  'braska', 'brasek', 'brasku',
  'taska', 'tasky', 'tasku',
  // ── Czech: material-adjective leads (always head an accessory title) ─────
  'silikonovy', 'silikonova', 'silikonove',
  'plastovy', 'plastova', 'plastove',
  'gumovy', 'gumova', 'gumove',
  'magneticky', 'magneticka', 'magneticke',
  // ── Czech: accessories / parts (generic) ────────────────────────────────
  'prislusenstvi', 'prislusenstve',
  'dily', 'nahradni',
  // ── English ─────────────────────────────────────────────────────────────
  'case', 'cases',
  'cover', 'covers',
  'charger',
  'cable',
  'adapter',
  'stand',
  'holder',
  'protector',
  'glass', 'tempered',
  'film',
  'screen',
  'skin',
  'earphones', 'earbuds', 'headphones',
  'speaker',
  'dock',
  'wallet',
  'sleeve',
  'pouch',
  'strap', 'straps',
  'band', 'bands',
  'mount',
  'grip',
  'bracelet',
  'powerbank',
  'bumper',
  'flip',
  'hub',
  'replacement',
  'accessory', 'accessories',
];

const DEFAULT_FOR_PREPOSITIONS = [
  'pro', 'na', 'for', 'k', 'do', 'kompatibilni', 'compatible',
];

// Tokens that only appear in whole-vehicle titles ("Škoda Octavia 2.0 TDI
// 110kW DSG"), never in spare-part listings. When one is present, the
// product-then-accessory pattern (d) is skipped, so a car advertised with
// bonus wheels ("… 2x kola, zimní pneu") is not misclassified as a part.
// Noun-led patterns (b)/(c) ("Alu kola pro Octavii") still apply.
const WHOLE_ITEM_SPEC_TOKENS = new Set([
  // cars — engine/drivetrain specs
  'tdi', 'tsi', 'mpi', 'dsg', 'kw', 'hdi', 'dci', 'cdti', 'crdi', 'tgi',
  'tfsi', 'vtec', 'cvt', 'xdrive', 'quattro', '4x4', '4matic', 'awd',
  // electronics — storage size ("128 GB") marks a whole device, not a part
  'gb', 'tb',
]);

/**
 * Accessory-noun matching. Entries ending in "*" are STEMS matched by prefix,
 * covering Czech declensions — "svetl*" matches svetlo / svetla / svetel /
 * svetlomet. All other entries match exactly, so "motor" cannot swallow
 * "motorka" and "band" cannot swallow "bandage".
 */
function isAccessoryNounToken(token: string, nouns: Set<string>): boolean {
  if (nouns.has(token)) return true;
  for (const noun of nouns) {
    if (noun.endsWith('*') && token.startsWith(noun.slice(0, -1))) return true;
  }
  return false;
}

/**
 * Returns true when the title is an accessory listed "for" the queried product.
 *
 * Three detection paths:
 *  (b) Preposition — "Kryt pro iPhone 13"
 *  (c) Direct follow — "Remínek Apple Watch 44mm"
 *  (d) Product then accessory — "iPhone 13 kryt", "Apple Watch remínek"
 */
function isAccessoryForQuery(
  titleTokens: string[],
  queryTokens: string[],
  accessoryHeadNouns: Set<string>,
  forPrepositions: Set<string>,
): boolean {
  if (titleTokens.length < 2 || queryTokens.length === 0) return false;

  // (a) Title must start with an accessory noun (first 2 tokens)
  const accessoryLeadIdx = titleTokens.slice(0, 2).findIndex((t) => isAccessoryNounToken(t, accessoryHeadNouns));

  if (accessoryLeadIdx !== -1) {
    const afterLead = titleTokens.slice(accessoryLeadIdx + 1);

    // (b) Query tokens appear AFTER a "for" preposition
    for (let i = accessoryLeadIdx; i < titleTokens.length - 1; i++) {
      if (!forPrepositions.has(titleTokens[i])) continue;
      const afterPrep = titleTokens.slice(i + 1);
      const matchedAfterPrep = queryTokens.filter((qt) =>
        afterPrep.some((tt) => tokenMatches(tt, qt)),
      );
      if (matchedAfterPrep.length >= Math.ceil(queryTokens.length * 0.5)) return true;
    }

    // (c) Most query tokens appear directly after the accessory noun (no
    // preposition) — majority (not all), so "Disky Octavia II" still caps a
    // "škoda octavia" query even though the title omits the brand.
    const matchedAfterLead = queryTokens.filter((qt) =>
      afterLead.some((tt) => tokenMatches(tt, qt)),
    );
    if (matchedAfterLead.length >= Math.ceil(queryTokens.length * 0.5)) return true;
  }

  // (d) Accessory noun anywhere in the title — real Czech listings bury the
  // part noun mid-title ("Levý přední blatník Škoda Octavia 2", "originální
  // OEM displej Škoda Octavia 4"), so positional patterns miss them.
  // Titles carrying whole-item spec tokens are exempt: a car advertised as
  // "2.0 TDI 110kW … + zimní kola" or a phone as "128 GB … + kryt" is the
  // product itself, not a part (noun-LED titles above cap regardless —
  // "Motor 1.9 TDI z Škoda Octavia" is still a part).
  if (titleTokens.some((t) => WHOLE_ITEM_SPEC_TOKENS.has(t))) return false;

  if (titleTokens.some((t) => isAccessoryNounToken(t, accessoryHeadNouns))) {
    const matched = queryTokens.filter((qt) =>
      titleTokens.some((tt) => tokenMatches(tt, qt)),
    );
    if (matched.length >= Math.ceil(queryTokens.length * 0.5)) return true;
  }

  return false;
}

// ─── Stopwords ────────────────────────────────────────────────────────────────

const DEFAULT_STOPWORDS = [
  // Czech
  'a', 'i', 'o', 'u', 'v', 'z', 'k', 's', 'na', 'za', 'do',
  'od', 'po', 've', 'ze', 'ke', 'se', 'si', 'je', 'to', 'ta',
  'ten', 'ty', 'pro', 'pri', 'jak', 'jako', 'tak', 'ale',
  'co', 'ze', 'že', 'nebo', 'nad', 'pod', 'pri', 'bez',
  // English
  'the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'for',
  'and', 'or', 'but', 'with', 'is', 'are', 'was', 'be',
];

// ─── Token helpers ────────────────────────────────────────────────────────────

function isNumeric(t: string): boolean {
  return /^\d+(\.\d+)?$/.test(t);
}

function tokenize(s: string): string[] {
  return stripDiacritics(normalizeInput(s).toLowerCase())
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function filterQueryTokens(tokens: string[], stopwords: Set<string>): string[] {
  const filtered = tokens.filter((t) => t.length > 2 && !stopwords.has(t));
  return filtered.length > 0 ? filtered : tokens;
}

// ─── Fuzzy matching ───────────────────────────────────────────────────────────
//
// Levenshtein distance ≤ 1 for tokens ≥ 5 chars.
// Handles common typos: "iphoen" → "iphone", "samsugn" → "samsung".

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const temp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = temp;
    }
  }
  return dp[a.length];
}

/**
 * Returns true when dt (document token) matches qt (query token).
 * Numeric tokens must match exactly. Text tokens use substring match with
 * minimum lengths — without them the title token "a" would match the query
 * token "octavia" ('octavia'.includes('a')) and every Czech conjunction
 * would count as a query hit. Falls back to Levenshtein ≤ 1 for longer tokens.
 */
function tokenMatches(dt: string, qt: string): boolean {
  if (isNumeric(qt)) return dt === qt;
  if (dt === qt) return true;
  if (qt.length >= 3 && dt.includes(qt)) return true;
  if (dt.length >= 4 && qt.includes(dt)) return true;
  if (qt.length >= 5 && dt.length >= 5) return levenshtein(dt, qt) <= 1;
  return false;
}

// ─── Phrase proximity ─────────────────────────────────────────────────────────

function phraseBonus(queryTokens: string[], titleTokens: string[]): number {
  if (queryTokens.length < 2) return 0;

  const phrase = queryTokens.join(' ');
  const titleStr = titleTokens.join(' ');
  if (titleStr.includes(phrase)) return 0.15;

  let windowBonus = 0;
  for (let i = 0; i <= titleTokens.length - queryTokens.length; i++) {
    const window = titleTokens.slice(i, i + queryTokens.length + 1);
    const covered = queryTokens.every((qt) => window.some((wt) => tokenMatches(wt, qt)));
    if (covered) { windowBonus = 0.08; break; }
  }
  return windowBonus;
}

// ─── Main scoring function ────────────────────────────────────────────────────

export function scoreRelevance(
  query: string,
  title: string,
  description: string | null,
  marketConfig?: Pick<MarketConfig, 'stopwords' | 'accessoryHeadNouns' | 'forPrepositions'>,
): number {
  const rawQueryTokens = tokenize(query);
  if (rawQueryTokens.length === 0) return 0.5;

  const stopwords = new Set([
    ...DEFAULT_STOPWORDS,
    ...(marketConfig?.stopwords ?? []),
  ]);
  const accessoryHeadNouns = new Set([
    ...DEFAULT_ACCESSORY_HEAD_NOUNS,
    ...(marketConfig?.accessoryHeadNouns ?? []),
  ]);
  const forPrepositions = new Set([
    ...DEFAULT_FOR_PREPOSITIONS,
    ...(marketConfig?.forPrepositions ?? []),
  ]);

  const queryTokens = filterQueryTokens(rawQueryTokens, stopwords);
  const titleTokens = tokenize(title);

  // ── Accessory guard ───────────────────────────────────────────────────────
  const queryMentionsAccessory = queryTokens.some((t) => isAccessoryNounToken(t, accessoryHeadNouns));
  if (!queryMentionsAccessory && isAccessoryForQuery(titleTokens, queryTokens, accessoryHeadNouns, forPrepositions)) {
    return 0.05;
  }
  // ─────────────────────────────────────────────────────────────────────────

  const descTokens = description ? tokenize(description) : [];
  const docTokens = [...titleTokens, ...descTokens];

  let hits = 0;
  for (const qt of queryTokens) {
    if (docTokens.some((dt) => tokenMatches(dt, qt))) hits++;
  }

  const baseScore = hits / queryTokens.length;

  let titleHits = 0;
  for (const qt of queryTokens) {
    if (titleTokens.some((dt) => tokenMatches(dt, qt))) titleHits++;
  }
  const titleBonus = (titleHits / queryTokens.length) * 0.2;

  const proximity = phraseBonus(queryTokens, titleTokens);

  return Math.min(1, baseScore + titleBonus + proximity);
}
import type { MarketConfig } from '@sdf/types';
