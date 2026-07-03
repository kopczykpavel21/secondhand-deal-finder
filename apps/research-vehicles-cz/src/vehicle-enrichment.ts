import type { NormalizedListing } from '@sdf/types';
import { VEHICLE_BRANDS } from './query-matrix.js';

export type YearOriginSource = 'listing_field' | 'vin' | 'generation_map' | 'unknown';
export type ListingKind = 'vehicle' | 'parts' | 'unknown';

export interface VehicleConditionFlags {
  repairNeeded: boolean;
  accidentDamaged: boolean;
  engineIssue: boolean;
  transmissionIssue: boolean;
  rustIssue: boolean;
  electronicsIssue: boolean;
  serviceHistory: boolean;
  firstOwner: boolean;
  garaged: boolean;
}

export interface VehicleEnrichment {
  normalizedBrand: string | null;
  normalizedModel: string | null;
  listingKind: ListingKind;
  yearOrigin: number | null;
  yearOriginSource: YearOriginSource;
  yearOriginConfidence: number;
  mileageKm: number | null;
  vin: string | null;
  fuelType: string | null;
  transmission: string | null;
  bodyType: string | null;
  sellerType: 'dealer' | 'private' | 'unknown';
  flags: VehicleConditionFlags;
}

const CURRENT_YEAR = new Date().getFullYear();

const BRAND_ALIASES = new Map<string, string>();
for (const seed of VEHICLE_BRANDS) {
  for (const name of [seed.brand, ...(seed.aliases ?? [])]) {
    BRAND_ALIASES.set(normalizeToken(name), seed.brand);
  }
}

const BODY_TYPE_KEYWORDS: Array<[string, RegExp]> = [
  ['hatchback', /\bhatchback\b/i],
  ['sedan', /\bsedan\b/i],
  ['wagon', /\b(kombi|combi|wagon)\b/i],
  ['suv', /\b(suv|crossover)\b/i],
  ['mpv', /\b(mpv|minivan)\b/i],
  ['van', /\b(van|dodavka)\b/i],
  ['coupe', /\b(coupe)\b/i],
  ['cabrio', /\b(cabrio|kabriolet)\b/i],
];

const FUEL_TYPE_KEYWORDS: Array<[string, RegExp]> = [
  ['diesel', /\b(tdi|dci|hdi|cdi|diesel|nafta)\b/i],
  ['petrol', /\b(tsi|tfsi|benzin|benzinovy|mpi|fsi)\b/i],
  ['hybrid', /\b(hybrid|hev|phev)\b/i],
  ['electric', /\b(ev|elektro|electric)\b/i],
  ['lpg', /\b(lpg)\b/i],
  ['cng', /\b(cng)\b/i],
];

const TRANSMISSION_KEYWORDS: Array<[string, RegExp]> = [
  ['automatic', /\b(automat|dsg|tiptronic)\b/i],
  ['manual', /\b(manual)\b/i],
];

const DEALER_HINTS = /\b(autosalon|autobazar|aaa auto|esa|dealer|prodejce|icar|auto centrum)\b/i;
const PARTS_HINTS = /\b(dily|na dily|motor|prevodovka|disky|kola|pneu|alternator|svetlo|svetlomet|kapota|naraznik|turbo|filtr|airbag|maska|grill|tesneni|blatnik|pruzina|zrcatko|radio|autoradio|reproduktor|volant|dvere|sklo|steracu|stiracu|kabel|zasuvka|snimac|clona|mechanismus|klika|drzak|plechovek|napoj[eá]|vetrak|ventilace|modul|nalepka|spojka)\b/i;
const NON_VEHICLE_HINTS = /\b(hot wheels|matchbox|lego|stavebnice|prospekt|mikina|monster truck|1\/18|1\/24|1\/43|autickem|vinylova nalepka)\b/i;
const VEHICLE_STRONG_HINTS = /\b(\d\.\d\s*(tdi|tsi|tdci|gdi|ecoboost|t-gdi|mhev|hev)|\d{2,3}\s*k[wW]\b|dsg\b|4x4\b|combi\b|kombi\b|sedan\b|hatchback\b|suv\b|rv\.?\s*\d{2,4}|r\.v\.|prvni registrace|1\.\s*majitel|najeto|tkm\b|tis\b.*km|my\s*20\d{2}|model(?:ovy)?\s+rok\s+20\d{2})\b/i;

const YEAR_FIELD_HINTS = /\b(rok(?:\s+vyroby)?|rv|prvni\s+registrace|1\.\s*registrace|modelovy\s+rok|my)\b/i;
const CONTEXTUAL_YEAR_PATTERNS: RegExp[] = [
  /\b(?:rok(?:\s+vyroby)?|r\.?\s*v\.?|rv|vyrobeno|vyroba)\s*[:\-]?\s*(19\d{2}|20\d{2})\b/i,
  /\b(?:prvni\s+registrace|1\.\s*registrace|registrace)\s*[:\-]?\s*(?:\d{1,2}[./-])?(19\d{2}|20\d{2})\b/i,
  /\bmy\s*(20\d{2})\b/i,
  /\bmodel(?:ovy)?\s+rok\s*(20\d{2})\b/i,
  /\b(?:\d{1,2}[./-])(19\d{2}|20\d{2})\b/i,
];

const REPAIR_HINTS = /\b(na opravu|nepojizdne|vadny|porucha|rozbite|poskozene|na dily)\b/i;
const ACCIDENT_HINTS = /\b(havarovane|bourane|po nehode|lehce bourane)\b/i;
const ENGINE_HINTS = /\b(motor\s+(vadny|klepe|nejede)|zadreny\s+motor|pridreny motor|oil consumption)\b/i;
const TRANSMISSION_HINTS = /\b(prevodovka\s+(vadna|spatna)|spojka\s+spatna)\b/i;
const RUST_HINTS = /\b(rez|koroze|zkorodovane)\b/i;
const RUST_NEGATION_HINTS = /\b(bez koroze|bez rezi|bez rzi)\b/i;
const ELECTRONICS_HINTS = /\b(elektronika|elektroinstalace|chyba\s+airbag|sviti kontrolka|ridici jednotka)\b/i;
const SERVICE_HINTS = /\b(servisni\s+knizka|servisni\s+historie|servisovano)\b/i;
const FIRST_OWNER_HINTS = /\b(prvni\s+majitel|1\.\s*majitel)\b/i;
const GARAGED_HINTS = /\b(garazovane)\b/i;

const VIN_YEAR_MAP: Record<string, number> = {
  A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017,
  J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025, T: 2026,
  Y: 2000, '1': 2001, '2': 2002, '3': 2003, '4': 2004, '5': 2005, '6': 2006,
  '7': 2007, '8': 2008, '9': 2009,
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeToken(value: string): string {
  return decodeBasicEntities(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function listingText(listing: NormalizedListing): string {
  return normalizeWhitespace(
    decodeBasicEntities([listing.title, listing.description ?? ''].filter(Boolean).join(' ')),
  );
}

function detectBrand(text: string, queryBrand: string | null): string | null {
  const normalizedText = normalizeToken(text);

  if (queryBrand) {
    const mapped = BRAND_ALIASES.get(normalizeToken(queryBrand));
    if (mapped) return mapped;
  }

  for (const [alias, canonical] of BRAND_ALIASES.entries()) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(normalizedText)) {
      return canonical;
    }
  }

  return null;
}

function detectModel(titleText: string, brand: string | null, queryModel: string | null): string | null {
  if (!brand) return null;

  const normalizedTitle = normalizeToken(titleText);
  const brandSeed = VEHICLE_BRANDS.find((item) => item.brand === brand);
  if (!brandSeed) return null;

  if (queryModel) {
    const escaped = normalizeToken(queryModel).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(normalizedTitle)) return queryModel;
  }

  for (const model of brandSeed.models) {
    const escaped = normalizeToken(model).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(normalizedTitle)) return model;
  }

  return null;
}

function classifyListingKind(text: string): ListingKind {
  const normalized = normalizeToken(text);
  if (NON_VEHICLE_HINTS.test(normalized)) return 'parts';
  if (PARTS_HINTS.test(normalized)) return 'parts';
  if (VEHICLE_STRONG_HINTS.test(normalized)) return 'vehicle';
  if (YEAR_FIELD_HINTS.test(normalized) || /\b\d{4}\b/.test(normalized)) return 'vehicle';
  return 'unknown';
}

function findCandidateYears(text: string): number[] {
  const matches = text.match(/\b(19[89]\d|19\d{2}|20\d{2})\b/g) ?? [];
  const years = matches
    .map((item) => Number(item))
    .filter((year) => year >= 1980 && year <= CURRENT_YEAR);

  return [...new Set(years)];
}

function findContextualYears(text: string): number[] {
  const years: number[] = [];
  for (const pattern of CONTEXTUAL_YEAR_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))) {
      const year = Number(match[1]);
      if (Number.isFinite(year) && year >= 1980 && year <= CURRENT_YEAR) {
        years.push(year);
      }
    }
  }
  return [...new Set(years)];
}

function extractYearFromMetadata(rawMetadata: Record<string, unknown>): number | null {
  const yearKeys = ['year', 'rok', 'firstRegistration', 'first_registration', 'modelYear', 'model_year', 'yearText', 'registrationYear', 'firstRegistrationYear', 'dateFirstRegistration'];

  for (const key of yearKeys) {
    const raw = rawMetadata[key];
    if (typeof raw === 'number' && raw >= 1980 && raw <= CURRENT_YEAR + 1) return raw;
    if (typeof raw === 'string') {
      const years = findCandidateYears(raw);
      if (years.length > 0) return years[0];
    }
  }

  return null;
}

function extractVin(text: string, rawMetadata: Record<string, unknown>): string | null {
  const vinFromRaw = typeof rawMetadata.vin === 'string' ? rawMetadata.vin : null;
  const sourceText = [vinFromRaw, text].filter(Boolean).join(' ');
  const match = sourceText.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
  return match?.[0] ?? null;
}

function decodeYearFromVin(vin: string | null): number | null {
  if (!vin || vin.length !== 17) return null;
  const code = vin[9];
  if (code === 'Z') return null;
  const year = VIN_YEAR_MAP[code];
  return year ?? null;
}

function extractYearOrigin(text: string, rawMetadata: Record<string, unknown>): {
  yearOrigin: number | null;
  yearOriginSource: YearOriginSource;
  yearOriginConfidence: number;
  vin: string | null;
} {
  const rawYear = extractYearFromMetadata(rawMetadata);
  if (rawYear) {
    return {
      yearOrigin: rawYear,
      yearOriginSource: 'listing_field',
      yearOriginConfidence: 1,
      vin: extractVin(text, rawMetadata),
    };
  }

  const contextualYears = findContextualYears(text);
  if (contextualYears.length > 0) {
    return {
      yearOrigin: contextualYears[0],
      yearOriginSource: 'listing_field',
      yearOriginConfidence: 0.95,
      vin: extractVin(text, rawMetadata),
    };
  }

  const years = findCandidateYears(text);
  if (years.length > 0) {
    return {
      yearOrigin: years[0],
      yearOriginSource: 'listing_field',
      yearOriginConfidence: 0.85,
      vin: extractVin(text, rawMetadata),
    };
  }

  const vin = extractVin(text, rawMetadata);
  const yearFromVin = decodeYearFromVin(vin);
  if (yearFromVin) {
    return {
      yearOrigin: yearFromVin,
      yearOriginSource: 'vin',
      yearOriginConfidence: 0.7,
      vin,
    };
  }

  return {
    yearOrigin: null,
    yearOriginSource: 'unknown',
    yearOriginConfidence: 0,
    vin,
  };
}

function extractMileage(text: string, rawMetadata: Record<string, unknown>): number | null {
  const directKeys = ['mileage', 'km', 'kilometers', 'kilometres'];
  for (const key of directKeys) {
    const raw = rawMetadata[key];
    if (typeof raw === 'number' && raw >= 0) return Math.round(raw);
    if (typeof raw === 'string') {
      const parsed = parseMileageText(raw);
      if (parsed != null) return parsed;
    }
  }

  return parseMileageText(text);
}

function parseMileageText(text: string): number | null {
  const clean = normalizeWhitespace(text);

  const explicitKmMatch = clean.match(/\b(\d{1,3}(?:[ .]\d{3})+|\d{4,6})\s*(?:km|kilometru|kilometru|kilometers?)\b/i);
  if (explicitKmMatch) {
    const numeric = Number(explicitKmMatch[1].replace(/[ .]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }

  const thousandKmMatch = clean.match(/\b(\d{1,3}(?:[.,]\d)?)\s*(?:tis(?:[íi]c)?|tis\.|tkm)\s*(?:km)?\b/i);
  if (thousandKmMatch) {
    const numeric = Number(thousandKmMatch[1].replace(',', '.'));
    return Number.isFinite(numeric) ? numeric * 1_000 : null;
  }

  const plainNumericAfterMileageHint = clean.match(/\b(?:najeto|najezd|stav\s+tachometru)\D{0,24}(\d{1,3}(?:[ .]\d{3})+|\d{4,6})\b/i);
  if (plainNumericAfterMileageHint) {
    const numeric = Number(plainNumericAfterMileageHint[1].replace(/[ .]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function detectKeywordValue(text: string, pairs: Array<[string, RegExp]>): string | null {
  const normalized = normalizeToken(text);
  for (const [value, pattern] of pairs) {
    if (pattern.test(normalized)) return value;
  }
  return null;
}

function inferSellerType(listing: NormalizedListing): 'dealer' | 'private' | 'unknown' {
  const haystack = normalizeToken([listing.sellerName, listing.location, listing.description, listing.title]
    .filter(Boolean)
    .join(' '));
  if (DEALER_HINTS.test(haystack)) return 'dealer';
  if (listing.sellerName) return 'private';
  return 'unknown';
}

function extractFlags(text: string): VehicleConditionFlags {
  const normalized = normalizeToken(text);
  const rustIssue = RUST_HINTS.test(normalized) && !RUST_NEGATION_HINTS.test(normalized);

  return {
    repairNeeded: REPAIR_HINTS.test(normalized),
    accidentDamaged: ACCIDENT_HINTS.test(normalized),
    engineIssue: ENGINE_HINTS.test(normalized),
    transmissionIssue: TRANSMISSION_HINTS.test(normalized),
    rustIssue,
    electronicsIssue: ELECTRONICS_HINTS.test(normalized),
    serviceHistory: SERVICE_HINTS.test(normalized),
    firstOwner: FIRST_OWNER_HINTS.test(normalized),
    garaged: GARAGED_HINTS.test(normalized),
  };
}

export function enrichVehicleListing(
  listing: NormalizedListing,
  queryBrand: string | null,
  queryModel: string | null,
): VehicleEnrichment {
  const text = listingText(listing);
  const titleText = normalizeWhitespace(decodeBasicEntities(listing.title ?? ''));
  const rawMetadata = listing.rawMetadata ?? {};

  const normalizedBrand = detectBrand(text, queryBrand);
  const normalizedModel = detectModel(titleText, normalizedBrand, queryModel);
  const { yearOrigin, yearOriginSource, yearOriginConfidence, vin } = extractYearOrigin(text, rawMetadata);
  const mileageKm = extractMileage(text, rawMetadata);

  return {
    normalizedBrand,
    normalizedModel,
    listingKind: classifyListingKind(text),
    yearOrigin,
    yearOriginSource,
    yearOriginConfidence,
    mileageKm,
    vin,
    fuelType: detectKeywordValue(text, FUEL_TYPE_KEYWORDS),
    transmission: detectKeywordValue(text, TRANSMISSION_KEYWORDS),
    bodyType: detectKeywordValue(text, BODY_TYPE_KEYWORDS),
    sellerType: inferSellerType(listing),
    flags: extractFlags(text),
  };
}
