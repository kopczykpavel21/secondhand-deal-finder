/**
 * Enrichment pipeline for the appliance durability harvest.
 *
 * Pure functions — no I/O. Takes a raw JSONL record and returns an EnrichedListing
 * with derived variables for the hedonic model and BDP construction. sellerName is
 * intentionally dropped here; the enriched output is the PII-free released dataset.
 *
 * Derived variables:
 *   brandParsed / brandConfidence  — matched brand from BRANDS dictionary
 *   functionalStatus               — working / degraded / broken (S1 signal)
 *   ageBandEnergy                  — pre2021 / post2021 from EU energy-label regime
 *   ageYearsStated / yearStated    — from text regex (signal a)
 *   ageBandFinal                   — triangulated: old / recent
 *   capacityKg / spinRpm           — parsed specs
 *   energyClassRaw                 — raw label string
 *   isRelevant                     — appliance-relevance filter (title + price bounds)
 *   priceEur                       — price normalised to EUR (fixed reference rate)
 *   citySize                       — large / medium / small
 */

import { CATEGORIES, type HarvestMarket } from './query-matrix.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export type FunctionalStatus = 'working' | 'degraded' | 'broken';
export type AgeBand = 'old' | 'recent';
export type EnergyAgeBand = 'pre2021' | 'post2021';
export type BrandConfidence = 'title' | 'description';
export type CitySize = 'large' | 'medium' | 'small';

export interface RawHarvestRecord {
  batchId: string;
  capturedAt: string;
  market: HarvestMarket;
  categoryId: string;
  brandQuery: string | null;
  queryText: string;
  id: string;
  source: string;
  sourceListingId: string;
  url: string | null;
  title: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  location: string | null;
  postedAt: string | null;
  conditionText: string | null;
  condition: string | null;
  imageCount: number | null;
  imageUrl: string | null;
  sellerName: string | null;
  sellerRating: number | null;
  sellerReviewCount: number | null;
  views: number | null;
  likes: number | null;
  promoted: boolean | null;
  rawMetadata?: unknown;
}

export interface EnrichedListing {
  // identifiers (sellerName dropped for PII)
  id: string;
  source: string;
  sourceListingId: string;
  url: string | null;
  market: HarvestMarket;
  categoryId: string;
  brandQuery: string | null;
  queryText: string;
  batchId: string;
  capturedAt: string;
  // original listing fields
  title: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  location: string | null;
  postedAt: string | null;
  conditionText: string | null;
  condition: string | null;
  imageCount: number | null;
  views: number | null;
  likes: number | null;
  promoted: boolean | null;
  // derived
  isRelevant: boolean;
  brandParsed: string | null;
  brandConfidence: BrandConfidence | null;
  functionalStatus: FunctionalStatus | null;
  ageBandEnergy: EnergyAgeBand | null;
  ageYearsStated: number | null;
  yearStated: number | null;
  ageBandFinal: AgeBand | null;
  capacityKg: number | null;
  spinRpm: number | null;
  energyClassRaw: string | null;
  priceEur: number | null;
  citySize: CitySize | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CURRENT_YEAR = 2026;

// Fixed reference exchange rates — document in paper as reference rate (mid-2026 approx.)
const CZK_TO_EUR = 1 / 25.0;
const PLN_TO_EUR = 1 / 4.25;

// Price plausibility bounds per market (in local currency); keeps room rentals / cars / villas out
const PRICE_MIN: Record<HarvestMarket, number> = { cz: 200, de: 10 };
const PRICE_MAX: Record<HarvestMarket, number> = { cz: 120_000, de: 5_000 };

// Per-category relevance terms (Czech + German), used for the isRelevant filter.
// Normalised (no diacritics, lowercase) at build time.
const CATEGORY_TERMS_NORM: Record<string, string[]> = {
  washing_machine: ['pracka', 'praci', 'pracek', 'waschmaschine', 'washing machine', 'pralni stroj'],
  dishwasher: ['mycka', 'mycek', 'geschirrspuler', 'spulmaschine', 'dishwasher', 'myci stroj'],
  fridge: ['lednice', 'chladnicka', 'lednicka', 'mrazak', 'mrazacek', 'kuhlschrank', 'kuhlkombi', 'fridge', 'refrigerator'],
  oven: ['trouba', 'sporak', 'troubi', 'backofen', 'herd', 'kochherd', 'oven', 'cooker'],
  dryer: ['susic', 'wascetrockner', 'warmepumpentrockner', 'tumble dryer', 'susicka'],
};

// Large cities by market — used for citySize inference.
const LARGE_CITY_NORMS = new Set([
  // CZ large (100k+)
  'praha', 'brno', 'ostrava', 'plzen', 'liberec', 'olomouc', 'usti nad labem',
  'ceske budejovice', 'hradec kralove', 'pardubice', 'havirov', 'zlin', 'kladno', 'most',
  // DE large (200k+)
  'berlin', 'hamburg', 'munchen', 'koln', 'frankfurt', 'stuttgart', 'dusseldorf',
  'leipzig', 'dortmund', 'essen', 'bremen', 'dresden', 'hannover', 'nurnberg',
  'duisburg', 'bochum', 'wuppertal', 'bielefeld', 'bonn', 'munster',
]);

const MEDIUM_CITY_NORMS = new Set([
  // CZ medium (50k-100k)
  'opava', 'frydek-mistek', 'karvina', 'jihlava', 'teplice', 'mlada boleslav',
  'prostejov', 'prerov', 'ceske budejovice', 'decin', 'chomutov', 'zlin',
  // DE medium (100k-200k)
  'augsburg', 'karlsruhe', 'mannheim', 'wiesbaden', 'gelsenkirchen', 'aachen',
  'braunschweig', 'kiel', 'chemnitz', 'halle', 'magdeburg', 'erfurt',
]);

// Brand dictionary: normalized → canonical brand name.
// "normalized" = lowercase + no diacritics (matches normText output).
const BRAND_NORM_MAP: Record<string, string> = {
  bosch: 'Bosch',
  siemens: 'Siemens',
  miele: 'Miele',
  aeg: 'AEG',
  electrolux: 'Electrolux',
  elektrolux: 'Electrolux',     // common CZ misspelling
  whirlpool: 'Whirlpool',
  beko: 'Beko',
  samsung: 'Samsung',
  lg: 'LG',
  gorenje: 'Gorenje',
  candy: 'Candy',
  indesit: 'Indesit',
  zanussi: 'Zanussi',
  bauknecht: 'Bauknecht',
  privileg: 'Privileg',
  hoover: 'Hoover',
  haier: 'Haier',
  hisense: 'Hisense',
  sharp: 'Sharp',
  liebherr: 'Liebherr',
  mora: 'Mora',
  philco: 'Philco',
  eta: 'ETA',
  concept: 'Concept',
  romo: 'Romo',
};

// Pre-compiled brand patterns sorted longest-first to avoid partial matches.
function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const BRAND_PATTERNS: Array<{ canonical: string; re: RegExp }> = Object.entries(BRAND_NORM_MAP)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([norm, canonical]) => ({
    canonical,
    // Unicode word boundary via lookbehind/lookahead to handle special chars
    re: new RegExp(`(?<![a-z0-9])${escRe(norm)}(?![a-z0-9])`, 'i'),
  }));

// ─── Text normalisation ───────────────────────────────────────────────────────

function normText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Brand parser ─────────────────────────────────────────────────────────────

function parseBrand(
  title: string | null,
  description: string | null,
): { brandParsed: string | null; brandConfidence: BrandConfidence | null } {
  for (const field of ['title', 'description'] as const) {
    const raw = field === 'title' ? title : description;
    const norm = normText(raw);
    if (!norm) continue;
    for (const { canonical, re } of BRAND_PATTERNS) {
      if (re.test(norm)) return { brandParsed: canonical, brandConfidence: field };
    }
  }
  return { brandParsed: null, brandConfidence: null };
}

// ─── Functional status (S1 signal) ───────────────────────────────────────────

// Czech broken / degraded / working cues
const BROKEN_CZ = /\b(na dily|nefunkcni|poskozeny|poskozena|k oprave|k opraveni|defektni|rozbity|neopravena|havarovan|nefunkcni)\b/;
const BROKEN_DE = /\b(defekt|kaputt|bastler|fur ersatzteile|ersatzteile|nicht funktionsfahig|geht nicht|funktioniert nicht)\b/;
const DEGRADED_CZ = /\b(drobne vady|drobne poskozeni|funkcni s vadou|chybovy kod|chybny kod|obcasna chyba|nehlasi|cukat|hacku)\b/;
const DEGRADED_DE = /\b(leichte kratzer|kleine mangel|mit mangeln|gebrauchsspuren|beschadigt|kleinere mangel)\b/;
const WORKING_CZ = /\b(funkcni|v poradku|v provozu|vyborny stav|dobry stav|plne funkcni|funguje|plnohodnotne)\b/;
const WORKING_DE = /\b(voll funktionsfahig|funktionsfahig|einwandfrei|sehr gut erhalten|gut erhalten|funktioniert)\b/;

function inferFunctionalStatus(
  condition: string | null,
  conditionText: string | null,
  title: string | null,
  description: string | null,
): FunctionalStatus | null {
  // Use the already-inferred condition field first (most reliable for Bazoš)
  if (condition === 'for_parts') return 'broken';
  if (condition === 'poor') return 'degraded';
  if (condition === 'good' || condition === 'very_good' || condition === 'new' || condition === 'like_new') return 'working';
  if (condition === 'fair') return 'working';

  // Fallback: scan all text (normalised, no diacritics)
  const all = normText([conditionText, title, description].filter(Boolean).join(' '));
  if (BROKEN_CZ.test(all) || BROKEN_DE.test(all)) return 'broken';
  if (DEGRADED_CZ.test(all) || DEGRADED_DE.test(all)) return 'degraded';
  if (WORKING_CZ.test(all) || WORKING_DE.test(all)) return 'working';

  return null;
}

// ─── Age triangulation ────────────────────────────────────────────────────────

function parseStatedAge(text: string | null): { ageYears: number | null; yearStated: number | null } {
  if (!text) return { ageYears: null, yearStated: null };

  // CZ: "stáří X let" / "X let starý/stará/staré" / "X let v provozu" / "X roků" (normalised, no diacritics)
  const czAgeRe = /\b(?:stari|stare?)\s+(\d{1,2})\s*(?:let|roku|roku)\b|\b(\d{1,2})\s*let\s+(?:stary|stara|stare|v provozu|v pouzivani)\b/;
  const czAgeM = normText(text).match(czAgeRe);
  if (czAgeM) {
    const y = parseInt(czAgeM[1] ?? czAgeM[2]);
    if (y >= 1 && y <= 30) return { ageYears: y, yearStated: CURRENT_YEAR - y };
  }

  // DE: "X Jahre alt" / "Alter: X Jahre" / "vor X Jahren"
  const deAgeRe = /\b(\d{1,2})\s*jahre?\s+(?:alt|in betrieb|jung)\b|\bvor\s+(\d{1,2})\s*jahre?n?\b|\balter\s*:?\s*(\d{1,2})\s*jahre?\b/i;
  const deAgeM = normText(text).match(deAgeRe);
  if (deAgeM) {
    const y = parseInt(deAgeM[1] ?? deAgeM[2] ?? deAgeM[3]);
    if (y >= 1 && y <= 30) return { ageYears: y, yearStated: CURRENT_YEAR - y };
  }

  // CZ: "koupeno YYYY" / "zakoupeno YYYY" / "rok výroby YYYY" / "z roku YYYY"
  const czYearRe = /\b(?:koupeno|zakoupeno|koupena|rok vyroby|rok koupe|rok nakupu|vyrobeno|z roku)\s+(?:v\s+)?(\d{4})\b/;
  const czYearM = normText(text).match(czYearRe);
  if (czYearM) {
    const y = parseInt(czYearM[1]);
    if (y >= 1990 && y <= CURRENT_YEAR) return { ageYears: CURRENT_YEAR - y, yearStated: y };
  }

  // DE: "Baujahr YYYY" / "Bj. YYYY" / "Jahrgang YYYY" / "gekauft YYYY"
  const deYearRe = /\b(?:baujahr|bj\.?|jahrgang|kaufjahr|modelljahr|herstellungsjahr)\s*:?\s*(\d{4})\b|\bgekauft\s+(?:im\s+)?(\d{4})\b/i;
  const deYearM = text.match(deYearRe);
  if (deYearM) {
    const y = parseInt(deYearM[1] ?? deYearM[2]);
    if (y >= 1990 && y <= CURRENT_YEAR) return { ageYears: CURRENT_YEAR - y, yearStated: y };
  }

  return { ageYears: null, yearStated: null };
}

// EU energy-label rescaling — 1 March 2021 for washing machines, dishwashers, fridges.
// A+++ or A++ in text → definitively pre-2021 (no new-scale appliance can carry that label).
// No trailing \b after + chars: + is non-word so \b never fires there.
const ENERGY_PRE2021_RE = /\bA\s*\+{2,3}(?=[^+]|$)/;
// Raw energy class extraction — near energy-label context words to reduce false positives
const ENERGY_CLASS_RAW_RE = /\bA\s*\+{0,3}(?=[^+]|$)|\b[B-G](?=\s*(?:třída|klasse|class|rated|energie|energy)|\s*[,)\n]|$)/i;

function parseEnergyInfo(
  text: string | null,
  categoryId: string,
): { ageBandEnergy: EnergyAgeBand | null; energyClassRaw: string | null } {
  if (!text) return { ageBandEnergy: null, energyClassRaw: null };

  const cat = CATEGORIES.find((c) => c.id === categoryId);
  const rescaled = cat?.energyRescaled2021 ?? false;

  const preMatch = text.match(ENERGY_PRE2021_RE);
  if (preMatch) {
    return {
      ageBandEnergy: rescaled ? 'pre2021' : null,
      energyClassRaw: preMatch[0].trim(),
    };
  }

  const classMatch = text.match(ENERGY_CLASS_RAW_RE);
  return { ageBandEnergy: null, energyClassRaw: classMatch ? classMatch[0].trim() : null };
}

// ─── Spec extraction ──────────────────────────────────────────────────────────

function parseCapacityKg(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/\b(\d{1,2}(?:[.,]\d)?)\s*kg\b/i);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  return v >= 4 && v <= 25 ? v : null; // plausibility: 4–25 kg for washing machines / dryers
}

function parseSpinRpm(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/\b(\d{3,4})\s*(?:rpm|ot\/min|U\/min|U·min|otacek)\b/i);
  if (!m) return null;
  const v = parseInt(m[1]);
  return v >= 400 && v <= 2200 ? v : null;
}

// ─── City size ────────────────────────────────────────────────────────────────

function inferCitySize(location: string | null): CitySize | null {
  if (!location) return null;
  const loc = normText(location);
  for (const city of LARGE_CITY_NORMS) {
    if (loc.includes(city)) return 'large';
  }
  for (const city of MEDIUM_CITY_NORMS) {
    if (loc.includes(city)) return 'medium';
  }
  return 'small';
}

// ─── Price normalisation ──────────────────────────────────────────────────────

function normalizePriceEur(price: number | null, currency: string | null): number | null {
  if (price == null) return null;
  const c = (currency ?? '').toUpperCase();
  if (c === 'EUR') return Math.round(price * 100) / 100;
  if (c === 'CZK' || c === 'KČ' || c === 'KC') return Math.round(price * CZK_TO_EUR * 100) / 100;
  if (c === 'PLN') return Math.round(price * PLN_TO_EUR * 100) / 100;
  return null;
}

// ─── Relevance filter ─────────────────────────────────────────────────────────

function isApplianceRelevant(
  title: string | null,
  price: number | null,
  market: HarvestMarket,
  categoryId: string,
): boolean {
  const normTitle = normText(title);
  if (!normTitle) return false;
  const terms = CATEGORY_TERMS_NORM[categoryId] ?? [];
  if (!terms.some((t) => normTitle.includes(t))) return false;
  if (price != null && (price < PRICE_MIN[market] || price > PRICE_MAX[market])) return false;
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function enrichListing(raw: RawHarvestRecord): EnrichedListing {
  const { brandParsed, brandConfidence } = parseBrand(raw.title, raw.description);

  const functionalStatus = inferFunctionalStatus(
    raw.condition, raw.conditionText, raw.title, raw.description,
  );

  const allText = [raw.title, raw.description].filter(Boolean).join(' ');
  const { ageBandEnergy, energyClassRaw } = parseEnergyInfo(allText, raw.categoryId);
  const { ageYears, yearStated } = parseStatedAge(allText);

  // Triangulate final age band:
  //   old    = A+++/A++ label (pre-2021 regime) OR stated age > 5 yr
  //   recent = stated age ≤ 5 yr  (energy regime alone can't confirm post2021 reliably)
  let ageBandFinal: AgeBand | null = null;
  if (ageBandEnergy === 'pre2021' || (ageYears != null && ageYears > 5)) ageBandFinal = 'old';
  else if (ageYears != null && ageYears <= 5) ageBandFinal = 'recent';

  return {
    id: raw.id,
    source: raw.source,
    sourceListingId: raw.sourceListingId,
    url: raw.url,
    market: raw.market,
    categoryId: raw.categoryId,
    brandQuery: raw.brandQuery,
    queryText: raw.queryText,
    batchId: raw.batchId,
    capturedAt: raw.capturedAt,
    title: raw.title,
    description: raw.description,
    price: raw.price,
    currency: raw.currency,
    location: raw.location,
    postedAt: raw.postedAt,
    conditionText: raw.conditionText,
    condition: raw.condition,
    imageCount: raw.imageCount,
    views: raw.views,
    likes: raw.likes,
    promoted: raw.promoted,
    // derived
    isRelevant: isApplianceRelevant(raw.title, raw.price, raw.market, raw.categoryId),
    brandParsed,
    brandConfidence,
    functionalStatus,
    ageBandEnergy,
    ageYearsStated: ageYears,
    yearStated,
    ageBandFinal,
    capacityKg: parseCapacityKg(allText),
    spinRpm: parseSpinRpm(allText),
    energyClassRaw,
    priceEur: normalizePriceEur(raw.price, raw.currency),
    citySize: inferCitySize(raw.location),
    // sellerName intentionally omitted (PII)
  };
}
