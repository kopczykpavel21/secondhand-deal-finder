/**
 * Listing-kind filter: is this listing the thing that was searched for, or
 * something around it — a spare part, an accessory, a toy model, a game for
 * the console, a phone sold for parts, a repair offer, a "Koupím" ad?
 *
 * Two kinds of evidence:
 *  1. The marketplace's own category (listing.category: Sbazar, Aukro,
 *     Sprzedajemy, the Bazoš section). Language-independent and reliable.
 *  2. Words in the title — for sources without categories (Vinted, Fler) and
 *     as a backup. Vinted shows cross-border listings, so the word lists mix
 *     Czech, Slovak, Polish, German and English.
 *
 * What counts as "around the product" depends on the search:
 *  - Car search ("škoda octavia", "porsche 911"): parts, toys/models, merch,
 *    any category that is not a vehicle category, and every listing from a
 *    site that sells no cars (Vinted, Fler).
 *  - Device search ("iphone 13", "playstation 5"): accessories, repair parts,
 *    toys, and games when the query is just the console.
 *  - Anything else: part/accessory categories only when they are NOT most of
 *    the results — when they are, they are what was searched ("xenony",
 *    "dualsense"). Toys and games are never hidden ("lego", "fifa 23").
 *  - Always: listings sold for parts ("na ND", "nefunkční"), wanted ads
 *    ("Koupím …"), repair offers and empty boxes.
 * A kind is never hidden when the query asks for it: "kryt iphone",
 * "lego porsche", "alu kola octavia", "iphone 13 na díly".
 */

import type { MarketConfig, NormalizedListing, Source } from '@sdf/types';
import {
  DEFAULT_ACCESSORY_HEAD_NOUNS,
  DEFAULT_FOR_PREPOSITIONS,
  DEFAULT_STOPWORDS,
  WHOLE_ITEM_SPEC_TOKENS,
  filterQueryTokens,
  isAccessoryForQuery,
  isAccessoryNounToken,
  normalizeNoun,
  tokenMatches,
  stripDiacritics,
  tokenize,
} from './relevance.js';
import {
  QUERY_ALIASES,
  createProductMatcher,
  isPatternPrice,
  type ProductMatcher,
} from './product-signature.js';

export type ListingKind =
  | 'for_parts'   // the product itself, sold broken / for parts
  | 'part'        // a spare part of the product
  | 'accessory'   // case, charger, controller, merch — or not the product at all
  | 'toy'         // toy, scale model, LEGO set of the product
  | 'media'       // a game or film for the console
  | 'service'     // repair / cleaning offer
  | 'wanted'      // "Koupím …" — a buyer's ad, not an offer
  | 'packaging'   // the empty box
  | 'other_model'; // another model of the same line: "iPhone 15" for "iphone 13"

export type QueryFamily = 'vehicle' | 'device' | 'other';

type ListingLike = Pick<NormalizedListing, 'title' | 'source' | 'price'> & { category?: string | null };
type MarketLike = Pick<MarketConfig, 'stopwords' | 'accessoryHeadNouns' | 'forPrepositions'>;

const set = (words: string[]) => new Set(words.map(normalizeNoun));

// ─── What the query is about ─────────────────────────────────────────────────
//
// Only unambiguous words. "golf", "polo", "mini", "smart", "superb" (VW Golf vs
// golf clubs, Mini vs iPhone mini) would turn ordinary searches into car
// searches; a model like that still counts when the brand is in the query.

const VEHICLE_BRANDS = set([
  'skoda', 'volkswagen', 'vw', 'audi', 'bmw', 'mercedes', 'ford', 'opel', 'renault',
  'peugeot', 'citroen', 'toyota', 'honda', 'mazda', 'nissan', 'hyundai', 'kia', 'fiat',
  'seat', 'cupra', 'dacia', 'volvo', 'porsche', 'suzuki', 'mitsubishi',
  'subaru', 'jeep', 'lexus', 'jaguar', 'chevrolet', 'chrysler', 'dodge', 'tatra',
  'trabant', 'wartburg', 'saab', 'lancia', 'romeo', 'rover', 'infiniti', 'isuzu',
  'ssangyong', 'maserati', 'ferrari', 'lamborghini', 'bentley', 'jawa', 'babetta',
  'ducati', 'harley', 'kawasaki', 'aprilia', 'simson', 'zetor',
  // not: tesla (Czech TESLA electronics), lada (Josef Lada), ktm (bicycles)
]);

const VEHICLE_MODELS = set([
  'octavia', 'octavii', 'fabia', 'fabii', 'kodiaq', 'karoq', 'kamiq', 'enyaq',
  'felicia', 'felicii', 'roomster', 'citigo', 'passat', 'touran', 'tiguan', 'sharan',
  'touareg', 'arteon', 'multivan', 'astra', 'corsa', 'insignia', 'zafira', 'vectra',
  'meriva', 'megane', 'scenic', 'laguna', 'kangoo', 'thalia', 'cayenne', 'macan',
  'panamera', 'boxster', 'cayman', 'taycan',
]);

/** Words that refine a car search without changing what is wanted. */
const VEHICLE_QUALIFIERS = set([
  'combi', 'kombi', 'sedan', 'hatchback', 'liftback', 'limuzina', 'scout', 'rs', 'vrs',
  'tdi', 'tsi', 'tfsi', 'mpi', 'dsg', 'kw', 'hp', 'ps', 'quattro', 'xdrive', 'awd',
  'benzin', 'nafta', 'diesel', 'lpg', 'cng', 'hybrid', 'elektro', 'automat', 'manual',
  'facelift', 'fl', 'sport', 'style', 'ambition', 'elegance', 'active', 'laurin',
  'klement', 'monte', 'carlo', 'coupe', 'cabrio', 'cabriolet', 'kabriolet', 'carrera',
  'turbo', 'gti', 'gtd', 'golf', 'polo', 'superb', 'rapid', 'yeti', 'scala', 'mini',
  'auto', 'auta', 'automobil', 'vuz', 'romeo', 'alfa', 'land', 'range', 'benz', 'mk',
]);

const DEVICE_TOKENS = set([
  'iphone', 'ipad', 'macbook', 'imac', 'galaxy', 'xiaomi', 'redmi', 'poco', 'pixel',
  'oneplus', 'huawei', 'honor', 'motorola', 'nokia', 'xperia', 'oppo', 'realme',
  'playstation', 'ps', 'psp', 'xbox', 'nintendo', 'konzole', 'konzola', 'konzoli',
  'notebook', 'laptop', 'thinkpad', 'ideapad', 'zenbook', 'vivobook', 'chromebook',
  'tablet', 'watch', 'garmin', 'fitbit', 'amazfit', 'kindle', 'steam',
  'telefon', 'telefonu', 'mobil', 'mobilni', 'smartphone', 'smartfon',
]);

const DEVICE_QUALIFIERS = set([
  'pro', 'max', 'mini', 'plus', 'ultra', 'lite', 'se', 'air', 'fe', 'note', 'edge',
  'fold', 'flip', 'oled', 'slim', 'digital', 'edition', 'series', 'apple', 'samsung',
  'sony', 'microsoft', 'lenovo', 'dell', 'hp', 'asus', 'acer', 'google', 'switch',
  'deck', 'gb', 'tb', 'ram', 'lte', 'wifi', 'cellular', 'hodinky', 'chytre', 'gen',
  'generace', 'retina', 'touch', 'bar', 'phone',
]);

const COLORS = set([
  'cern*', 'bil*', 'modr*', 'cerven*', 'zelen*', 'sed*', 'stribrn*', 'zlat*', 'ruzov*',
  'fialov*', 'oranzov*', 'zlut*', 'black', 'white', 'blue', 'red', 'green', 'gray',
  'grey', 'silver', 'gold', 'pink', 'purple', 'midnight', 'starlight', 'graphite',
]);

const ROMAN = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii']);

// ─── Kinds of listing: title words ───────────────────────────────────────────

/** Car parts that only make sense next to a car query (bikes are "kola" too). */
const VEHICLE_PART_NOUNS = set([
  'kola', 'kolo', 'disk', 'disky', 'alu', 'gumy', 'zimaky', 'letaky', 'retez*',
  'nosic*', 'strecni', 'autosedack*', 'ofuk*', 'zamek', 'zamk*', 'motorek',
  'stahovan*', 'airbag*', 'pedal*', 'climatronic*', 'klimatizac*', 'volant*', 'kufr*',
  'emblem*', 'logo', 'znak*', 'klika', 'kliky', 'ramen*', 'silentblok*', 'pruzin*',
  'senzor*', 'modul*', 'rele', 'pojistk*', 'svick*', 'zapalovan*', 'nadrz*', 'hadic*',
  'ventilator*', 'termostat*', 'olej*', 'remen*', 'napinak*', 'kladk*', 'dmychadl*',
  'intercooler*', 'egr', 'dpf', 'setrvacnik*', 'radici', 'razeni', 'pist*', 'ojnic*',
  'naboj*', 'kotouc*', 'destick*', 'celist*', 'strmen*', 'homokinet*', 'kloub*',
  'karoseri*', 'sloupek', 'mrizk*', 'gril*', 'blinkr*', 'smerovk*', 'koncov*',
  'zarovk*', 'xenon*', 'navigac*', 'parkovac*', 'zaves*', 'rezervni', 'rohoz*',
  'deflektor*', 'ovladac*', 'ovladani', 'dil', 'dilu', 'nd',
  // not "servisní": "…, servisní knížka" is a selling point of the car
  // Polish / German / English
  'czesc*', 'zderzak*', 'blotnik*', 'lampa', 'lampy', 'reflektor*', 'felg*', 'opon*',
  'kolpak*', 'lusterk*', 'drzwi', 'klapa', 'chlodnic*', 'rozrusznik*', 'wtrysk*',
  'sprzeglo', 'hamulc*', 'tarcz*', 'amortyzator*', 'wahacz*', 'emblemat*', 'dywanik*',
  'uszczelk*', 'reifen', 'scheinwerfer*', 'stossstange*', 'spiegel', 'motorhaube',
  'kotflugel*', 'bremse*', 'auspuff*', 'kupplung*', 'lenkrad*', 'grille', 'headlight*',
  'bumper', 'rims', 'tyres', 'tires',
]);

/** Merchandise of a car brand: shirts, posters, keyrings, brochures. */
const MERCH_NOUNS = set([
  'hodinky', 'plakat*', 'poster*', 'tricko*', 'triko', 'tricka', 'mikin*', 'cepic*',
  'ksiltovk*', 'klicenk*', 'privesk*', 'privesek', 'hrnek', 'hrnk*', 'kalendar*',
  'odznak*', 'samolepk*', 'magnetk*', 'vlajk*', 'knih*', 'navod*', 'katalog*',
  'prospekt*', 'brozur*', 'polstar*', 'koszulk*', 'brelok*', 'czapk*', 'kubek', 'kubk*',
  'bluza', 'bluzka', 'torba', 'breloc*', 'sapca', 'tricou', 'shirt*', 'tshirt*',
  'hoodie', 'cap', 'mug', 'keychain*', 'sticker*', 'schlusselanhanger', 'tasse',
]);

/** Repair parts of phones/laptops — noun-led only ("Displej iPhone 13", not
 *  "iPhone 13, nový displej"). */
const DEVICE_PART_NOUNS = set([
  'displej*', 'lcd', 'digitizer*', 'flex', 'bateri*', 'akumulator*', 'zakladni', 'deska',
  'desku', 'klavesnic*', 'touchpad*', 'panty', 'tlacitk*', 'mikrofon*', 'ssd', 'hdd',
  'wyswietlacz*', 'bateria', 'klawiatur*', 'plyta',
]);

/** Console accessories — noun-led only ("PS5 + 2 ovladače" is a bundle). */
const CONSOLE_ACCESSORY_NOUNS = set([
  'ovladac*', 'ovladani', 'gamepad*', 'controller*', 'kontroler*', 'dualsense',
  'dualshock', 'joycon*', 'joy', 'headset*', 'volant*', 'kamera', 'vr', 'pulse',
  'portal', 'nabijeci', 'chlazeni', 'pad', 'virtualni',
]);

/** Phone/console accessories in the neighbours' languages — vinted.cz shows
 *  Polish and German listings, which the Czech market list does not cover. */
const CROSS_BORDER_ACCESSORY_NOUNS = set([
  'etui', 'obudowa', 'pokrowiec', 'futeral', 'szklo', 'ladowarka', 'uchwyt', 'stojak',
  'pasek', 'bransoleta', 'sluchawki', 'glosnik', 'oslona', 'huelle', 'hulle',
  'ladegerat', 'ladekabel', 'halterung', 'schutzfolie', 'panzerglas', 'tasche', 'armband',
  'puzdro', 'nabijacka',
]);

/** Strap words that also end watch model names ("Epix Pro 47mm Black Band") —
 *  matched anywhere, the price check keeps the watches. */
const DEVICE_STRAP_NOUNS = set(['band', 'bands', 'loop']);

/** Car-part words that mean something else outside a car search ("horské kolo"). */
const NOT_A_PART_REQUEST = set(['kolo', 'kola', 'disk', 'disky']);

/** Leading words that say nothing about the item ("Prodám nový kryt …"). */
const TITLE_FILLER = set([
  'prodam', 'prodej', 'prodavam', 'predam', 'nabizim', 'sprzedam', 'sprzedaje',
  'verkaufe', 'novy', 'nova', 'nove', 'zanovni', 'pouzity', 'pouzita', 'pouzite',
  'original', 'originalni', 'originalny', 'oryginalny', 'orginal', 'top', 'super',
]);

/** Games/films — hidden only for a bare console search ("playstation 5"). */
const MEDIA_NOUNS = set([
  'hra', 'hry', 'her', 'hru', 'game', 'games', 'gra', 'gry', 'gier', 'spiel', 'spiele',
  'pecky', 'pecka', 'cd', 'dvd', 'bluray',
]);

const TOY_NOUNS = set([
  'hracka', 'hracky', 'hrack*', 'autick*', 'autodrah*', 'anglicak*', 'stavebnic*',
  'plysov*', 'figurk*', 'modelar*', 'rc', 'lego', 'duplo', 'playmobil', 'cobi',
  'matchbox', 'bburago', 'burago', 'majorette', 'siku', 'welly', 'maisto', 'schuco',
  'minichamps', 'abrex', 'deagostini', 'kaden', 'igra', 'revell', 'tamiya', 'italeri',
  'herpa', 'norev', 'solido', 'corgi', 'kinsmart', 'rastar', 'jamara', 'diecast',
  'autko', 'autka', 'zabawk*', 'resorak*', 'klock*', 'spielzeug*', 'modellauto*',
  'spielzeugauto*', 'jucari*', 'masinut*', 'toy', 'toys', 'puzzle',
]);
const TOY_PHRASES =
  /\b(hot wheels|model\w* auta|sberatelsk\w* model\w*|kovov\w* model\w*|model kolekcjonerski|die cast)\b/;
/** Scale models: "1:43", "1/18". Matched on the raw title — tokens lose the colon. */
const SCALE_RE =
  /\b1\s?[:/]\s?(8|10|12|14|16|18|20|24|25|32|35|36|43|48|50|55|60|64|72|76|87|100|120|144|160|200)\b/;

const PACKAGING_NOUNS = set(['krabice', 'krabic*', 'krabick*', 'krabica', 'pudelk*', 'karton', 'kartony']);
const PACKAGING_PHRASES =
  /\b(prazdn\w* krabic\w*|krabic\w* od|jen krabic\w*|pouze krabic\w*|empty box|box only|only box|pust\w* pudelk\w*|pudelk\w* po|karton po|leerkarton)\b/;

const FOR_PARTS_RE = new RegExp(
  '\\b(' + [
    'na nd', 'na dily', 'na nahradni dily', 'na soucastky', 'na opravu', 'na diely',
    'na czesci', 'pro dily', 'nefunkcni', 'nefunkcny', 'nefunkcne', 'nefunguje',
    'niesprawn\\w*', 'uszkodzon\\w*', 'nie dziala', 'defekt', 'defekte', 'defekter',
    'ersatzteilspender', 'bastler', 'for parts', 'not working', 'faulty',
    'icloud (lock|locked|blok\\w*|zamc\\w*)', '(blok\\w*|zamc\\w*) icloud',
    // a blocked phone (operator / iCloud / stolen-list) is a parts donor;
    // "odblokovaný" has no word boundary before "blok", "není blokovaný" is excluded
    '(?<!neni )(?<!nie jest )blokovan\\w*', '(?<!nie jest )zablokowan\\w*',
  ].join('|') + ')\\b',
);

const WANTED_WORDS = set([
  'koupim', 'kupim', 'vykoupim', 'vykup', 'shanim', 'hledam', 'poptavam', 'kupie',
  'szukam', 'suche', 'kaufe', 'wtb',
]);

// Not "servis": in Czech it is also a dinner set ("Jídelní servis Thun").
const SERVICE_NOUNS = set([
  'oprava', 'opravy', 'opravim', 'opravuji', 'cisteni', 'repair', 'serwis',
  'naprawa', 'reparatur', 'reparatur*',
]);
/** "Hledám nového majitele" is an offer, not a wanted ad. */
const NOT_WANTED_RE = /\bhledam nov\w* (majitel|domov)/;

const FOR_PARTS_TRIGGERS = set([
  'nd', 'dil', 'dily', 'nefunkcni', 'nefunkcny', 'oprav*', 'poskozen*', 'rozbit*',
  'blokovan*', 'icloud', 'czesci', 'uszkodzon*', 'defekt*', 'bastler', 'parts', 'broken',
]);

// ─── Kinds of listing: marketplace categories ────────────────────────────────
//
// Checked on the leaf category, then its parent — never higher, because the
// roots mix everything ("Počítače a hry", "telefony i akcesoria").

const CATEGORY_RULES: Array<[ListingKind, RegExp]> = [
  ['for_parts', /\bposkozen/],
  ['toy', /\b(hrack|lego|duplo|stavebnic|autodrah|auticka|anglicak|hot wheels|modelarstv|modely aut|sberatelske model|panenk|puzzle|plysov|vlacky|pro deti 6|pro deti od|pro batolata|stolni a spolecenske hry|karnevalov|zabawk|klocki|figurki|spielzeug|modellbau|modellauto)|^modely$|^deti$/],
  ['media', /\b(pocitacove hry|hry na|pc hry|gry na konsole|inne gry|videohry|blu ray|dvd filmy|hudba a cd|computerspiele|konsolenspiele)\b/],
  ['service', /\b(sluzb|uslug|dienstleist)/],
  ['part', /\b(nahradni dil|dily|casti karoserie|casti interieru|kola a disky|alu kola|pneumatik|osvetleni pro|svetla blinkr|zarovky|elektroinstalace|motory a prevodovky|tuning|komponenty k notebook|soucastky|vybaveni interieru|pro osobni vozidla|pro motocykly|na motorky|czesci|karoseria|szyby|do samochodow|ersatzteil|autoteile)/],
  ['accessory', /\b(prislusenstvi k|prislusenstvi pro|mobil prislusenstvi|herni prislusenstvi|doplnky a vybaveni|nabijecky|gamepady|ovladace|joysticky|pametove karty|sluchatka|merch|akcesoria gsm|pokrowce|futeraly|folie|akcesoria samochodowe|brasny|tasky na|sluchawki|zubehor)/],
];

/** Categories that hold whole vehicles — everything else is hidden for a car search. */
const VEHICLE_CATEGORY_RE =
  /\b(osobni automobil|osobni auta|autobazar|ostatni auta|bourana auta|veteran|do 3 5 t|uzitkov|dodavk|kamiony|tahace|ctyrkolk|motork|motocykl|skutr|samochody|osobowe|pkw|automobily|ostatni vyrobci)|^auto$/;
const CATEGORY_VEHICLE_BRANDS = new Set([...VEHICLE_BRANDS, 'mini', 'smart', 'alfa', 'land', 'mercedes']);

/** Sites that list no vehicles, or no phones/consoles (Fler is handmade goods). */
const NO_VEHICLE_SOURCES = new Set<Source>(['vinted', 'fler']);
const NO_DEVICE_SOURCES = new Set<Source>(['fler']);

function normalizeCategorySegment(segment: string): string {
  return stripDiacritics(segment.toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** "Accessory" categories that actually hold products: Sbazar files monitors,
 *  keyboards and mice under "PC příslušenství". */
const PRODUCT_CATEGORY_RE = /\b(pc prislusenstvi|prislusenstvi k pc)\b/;

/** The kind a marketplace category implies, or null when it holds products. */
export function categoryKind(category: string | null | undefined): ListingKind | null {
  if (!category) return null;
  const segments = category.split(' > ').map(normalizeCategorySegment).filter(Boolean);
  for (const segment of segments.slice(-2).reverse()) {
    if (PRODUCT_CATEGORY_RE.test(segment)) return null;
    for (const [kind, re] of CATEGORY_RULES) {
      if (re.test(segment)) return kind;
    }
  }
  return null;
}

export function isVehicleCategory(category: string): boolean {
  return category.split(' > ').map(normalizeCategorySegment).some((segment) =>
    VEHICLE_CATEGORY_RE.test(segment) ||
    segment.split(' ').some((t) => CATEGORY_VEHICLE_BRANDS.has(t)),
  );
}

// ─── Query analysis ───────────────────────────────────────────────────────────

export interface QueryIntent {
  family: QueryFamily;
  /** Every query word is the product's brand/model/spec, so anything that is
   *  not the product itself can go. "iphone 13 modrý" is pure,
   *  "fifa 23 ps5" is not (FIFA is the product, PS5 the platform). */
  pure: boolean;
  /** Kinds the query asks for — never hidden. */
  wants: Set<ListingKind>;
}

function matchesAny(token: string, nouns: Set<string>): boolean {
  return isAccessoryNounToken(token, nouns);
}

export function analyzeQuery(query: string, market?: MarketLike): QueryIntent {
  const tokens = tokenize(query);
  const marketNouns = set([...DEFAULT_ACCESSORY_HEAD_NOUNS, ...(market?.accessoryHeadNouns ?? [])]);

  const isVehicle = tokens.some((t) => VEHICLE_BRANDS.has(t) || VEHICLE_MODELS.has(t));
  const isDevice = !isVehicle && tokens.some((t) => DEVICE_TOKENS.has(t) || /^telefon|^mobil/.test(t));
  const family: QueryFamily = isVehicle ? 'vehicle' : isDevice ? 'device' : 'other';

  const isQualifier = (t: string) =>
    /^\d+$/.test(t) || t.length === 1 || ROMAN.has(t) || matchesAny(t, COLORS) ||
    (family === 'vehicle'
      ? VEHICLE_BRANDS.has(t) || VEHICLE_MODELS.has(t) || VEHICLE_QUALIFIERS.has(t)
      : DEVICE_TOKENS.has(t) || DEVICE_QUALIFIERS.has(t) || /^telefon|^mobil/.test(t));
  const pure = family !== 'other' && tokens.every(isQualifier);

  // Which accessory/part words count as "asking for an accessory" depends on
  // the search: "hodinky" is merch next to "porsche" but the product next to
  // "garmin".
  const accessoryWordLists =
    family === 'vehicle' ? [marketNouns, VEHICLE_PART_NOUNS, MERCH_NOUNS]
    : family === 'device' ? [marketNouns, DEVICE_PART_NOUNS, CONSOLE_ACCESSORY_NOUNS, CROSS_BORDER_ACCESSORY_NOUNS]
    : [marketNouns, VEHICLE_PART_NOUNS, DEVICE_PART_NOUNS, CONSOLE_ACCESSORY_NOUNS, CROSS_BORDER_ACCESSORY_NOUNS, MERCH_NOUNS];

  const wants = new Set<ListingKind>();
  for (const t of tokens) {
    if (family === 'other' && NOT_A_PART_REQUEST.has(t)) continue;
    if (matchesAny(t, FOR_PARTS_TRIGGERS)) wants.add('for_parts');
    if (matchesAny(t, TOY_NOUNS)) wants.add('toy');
    if (matchesAny(t, MEDIA_NOUNS)) wants.add('media');
    if (matchesAny(t, SERVICE_NOUNS)) wants.add('service');
    if (matchesAny(t, WANTED_WORDS)) wants.add('wanted');
    if (matchesAny(t, PACKAGING_NOUNS)) wants.add('packaging');
    if (accessoryWordLists.some((nouns) => matchesAny(t, nouns))) {
      wants.add('part');
      wants.add('accessory');
    }
  }
  if (TOY_PHRASES.test(tokens.join(' ')) || SCALE_RE.test(query.toLowerCase())) wants.add('toy');

  return { family, pure, wants };
}

// ─── The filter ───────────────────────────────────────────────────────────────

/**
 * True for "<something> <for-preposition> <the query phrase>": the query's
 * words, in order and together, start within two words after a preposition
 * that is not the title's first word. "Sedlo na silniční / horské kolo" for
 * "horské kolo" → true; "Horské kolo na díly" → false (the phrase leads);
 * "Dětské kolo pro děti" for "kolo pro děti" → false (the phrase is split).
 */
export function isMadeForQuery(
  titleTokens: string[],
  queryTokens: string[],
  forPrepositions: Set<string>,
): boolean {
  if (queryTokens.length === 0) return false;
  for (let i = 1; i < titleTokens.length - 1; i++) {
    if (!forPrepositions.has(titleTokens[i])) continue;
    for (let j = i + 1; j <= i + 3 && j + queryTokens.length <= titleTokens.length; j++) {
      if (queryTokens.every((qt, k) => tokenMatches(titleTokens[j + k], qt))) return true;
    }
  }
  return false;
}

/** Fewer categorised listings than this and "most of the results" means nothing. */
const MIN_CATEGORISED_FOR_MAJORITY = 8;

/**
 * A listing priced at least this share of the typical product price is kept
 * even when its category or wording says accessory/part/game/toy. Sellers
 * misfile ("iPhone 13", 6 500 Kč, under "Mobil - příslušenství"; a whole
 * Octavia for 89 000 Kč under "Náhradní díly") and bundles read like
 * accessories ("iPhone 13 + etui + szybka", "PS5 + 2 ovladače"), but no case,
 * game or toy costs 40 % of the phone or console. Car prices spread wider
 * (Octavias 50 000 – 900 000 Kč, median ~230 000) while even engines and wheel
 * sets stay under ~25 % of the median, hence the lower share for cars.
 */
const PRODUCT_PRICE_SHARE = { vehicle: 0.25, device: 0.4, other: 0.4 } as const;
/** Kinds the price check can overrule. Sold-for-parts, wanted ads and repair
 *  offers stay hidden whatever they cost. */
const PRICE_RESCUABLE = new Set<ListingKind>(['part', 'accessory', 'media', 'toy', 'packaging']);
/** "iPhone 13 s krabicí", "S21 + pudełko" — the box comes with the phone. */
const WITH_WORDS = set(['s', 'se', 'z', 'ze', 'i', 'a', 'with', 'mit', 'plus', 'vcetne', 'vc']);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * For a pure car search, a listing under half the price of the cheapest tenth
 * of real cars cannot be a car: "ABS škoda octavia 3" for 3 000 Kč filed under
 * the car category "Škoda" (cheapest Octavias ~49 000 Kč). Not for devices: a
 * "macbook pro" search spans 15 years of models, and a 2010 MacBook for
 * 1 000 Kč is still a MacBook. Prices of 10 Kč and below are placeholders
 * ("cena v textu") and are left alone.
 */
const TOO_CHEAP_SHARE_OF_P10 = 0.5;
const MIN_PRODUCTS_FOR_TOO_CHEAP = 10;

/**
 * When the query pins a model ("garmin fenix 7"), listings that name that
 * model give its price directly, and one priced under this share of their
 * upper quartile is not the product: a strap, a charger, the box, a dummy
 * ("Garmin remen 22 mm", "Cutie Samsung Galaxy S23", "S23 Ultra atrapa").
 * No word list needed, so it also catches the Croatian, Hungarian and
 * Romanian listings Vinted mixes in. The upper quartile rather than the median
 * because accessories that name the model are themselves in the sample and
 * pull the median down. The device rule above ("a 2010 MacBook for 1 000 Kč
 * is still a MacBook") does not apply here — a pinned model does not span 15
 * years. Listings between this share and a normal price stay visible and are
 * marked as suspiciously cheap by the price check instead.
 */
const FAR_BELOW_MODEL_SHARE = 0.15;
const MIN_MODEL_LISTINGS = 8;

/**
 * Build a filter for one search. Returns, per listing, the kind that makes it
 * "not the searched product", or null to keep it. `listings` is the whole
 * result set — used to tell whether parts/accessories are most of it.
 */
export interface ListingKindFilter {
  (listing: ListingLike): ListingKind | null;
  /** Priced like the searched product itself — a bundle, not an accessory. */
  pricedLikeProduct(listing: ListingLike): boolean;
  /** Model / variant / storage reader for this query — shared with the scorer. */
  matcher: ProductMatcher;
}

export function createListingKindFilter(
  query: string,
  listings: ListingLike[],
  market?: MarketLike,
): ListingKindFilter {
  const intent = analyzeQuery(query, market);
  const strong = intent.family !== 'other';

  const stopwords = set([...DEFAULT_STOPWORDS, ...(market?.stopwords ?? [])]);
  const baseQueryTokens = filterQueryTokens(tokenize(query), stopwords);
  const queryTokens = [...baseQueryTokens, ...baseQueryTokens.flatMap((t) => QUERY_ALIASES[t] ?? [])];
  const forPrepositions = set([...DEFAULT_FOR_PREPOSITIONS, ...(market?.forPrepositions ?? [])]);
  const matcher = createProductMatcher(query, { family: intent.family, stopwords });

  // Share of each category kind among listings whose source has categories.
  const counts = new Map<ListingKind | null, number>();
  let categorised = 0;
  for (const l of listings) {
    if (!l.category) continue;
    categorised++;
    const k = categoryKind(l.category);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const isMajority = (kind: ListingKind) =>
    categorised < MIN_CATEGORISED_FOR_MAJORITY || (counts.get(kind) ?? 0) / categorised >= 0.5;

  // Typical price of the product itself: listings filed in product categories
  // (vehicle categories for a car search).
  const productPrices = listings
    .filter((l) =>
      l.category && l.price != null && l.price > 0 && categoryKind(l.category) === null &&
      (intent.family !== 'vehicle' || isVehicleCategory(l.category)),
    )
    .map((l) => l.price as number);
  const productPrice = productPrices.length >= 5 ? median(productPrices) : null;
  const sortedProductPrices = [...productPrices].sort((a, b) => a - b);
  const tooCheapBelow =
    sortedProductPrices.length >= MIN_PRODUCTS_FOR_TOO_CHEAP
      ? sortedProductPrices[Math.floor((sortedProductPrices.length - 1) * 0.1)] * TOO_CHEAP_SHARE_OF_P10
      : null;
  const pricedLikeProduct = (l: ListingLike) =>
    productPrice != null && l.price != null &&
    l.price >= productPrice * PRODUCT_PRICE_SHARE[intent.family];

  const hides = (kind: ListingKind): boolean => {
    if (intent.wants.has(kind)) return false;
    switch (kind) {
      case 'for_parts':
      case 'service':
      case 'wanted':
      case 'packaging':
      case 'other_model':
        return true;
      case 'toy':
        return strong;
      case 'media':
        return intent.family === 'device' && intent.pure;
      case 'part':
      case 'accessory':
        return (strong && intent.pure) || !isMajority(kind);
    }
  };

  // Context word lists: (nouns, kind, noun-led only?)
  const contextNouns: Array<[Set<string>, ListingKind, boolean]> = [];
  if (intent.family === 'vehicle') {
    contextNouns.push([VEHICLE_PART_NOUNS, 'part', false], [MERCH_NOUNS, 'accessory', false]);
  } else if (intent.family === 'device') {
    contextNouns.push(
      [CROSS_BORDER_ACCESSORY_NOUNS, 'accessory', true],
      [DEVICE_STRAP_NOUNS, 'accessory', false],
      [DEVICE_PART_NOUNS, 'part', true],
      [CONSOLE_ACCESSORY_NOUNS, 'accessory', true],
      [MEDIA_NOUNS, 'media', true],
    );
  }

  const classify = (listing: ListingLike): ListingKind | null => {
    const titleTokens = tokenize(listing.title);
    const title = ` ${titleTokens.join(' ')} `;
    let start = 0;
    while (start < titleTokens.length - 1 && TITLE_FILLER.has(titleTokens[start])) start++;
    const itemTokens = titleTokens.slice(start);

    // 0. Another model of the same product line
    if (matcher.pinned && matcher.signature(listing.title).model === 'conflict') return 'other_model';

    // 1. Always-hidden title markers
    if (
      titleTokens.slice(0, 2).some((t) => WANTED_WORDS.has(t)) && !NOT_WANTED_RE.test(title) &&
      hides('wanted')
    ) return 'wanted';
    if (FOR_PARTS_RE.test(title) && hides('for_parts')) return 'for_parts';
    if (titleTokens.slice(0, 2).some((t) => SERVICE_NOUNS.has(t)) && hides('service')) return 'service';
    if (hides('packaging')) {
      const last = titleTokens[titleTokens.length - 1] ?? '';
      const beforeLast = titleTokens[titleTokens.length - 2] ?? '';
      const boxComesWithItem =
        WITH_WORDS.has(beforeLast) || /\+\s*\S+\s*$/.test(listing.title.trim()) ||
        titleTokens.some((t) => WHOLE_ITEM_SPEC_TOKENS.has(t));
      if (
        PACKAGING_PHRASES.test(title) ||
        titleTokens.slice(0, 2).some((t) => matchesAny(t, PACKAGING_NOUNS)) ||
        // a short title ending in the box ("PS5 Sony PlayStation Karton"); a long
        // one lists it as included ("Pad DualSense | Analogi TMR | Pudełko")
        (!boxComesWithItem && titleTokens.length > 1 && titleTokens.length <= 5 &&
          matchesAny(last, PACKAGING_NOUNS))
      ) return 'packaging';
    }

    // 2. Marketplace category. For a general search, a title that opens with
    // exactly what was searched beats the category: Sbazar sellers file
    // "Horské kolo Author" under the car category "Kola a disky".
    const fromCategory = categoryKind(listing.category);
    const titleIsTheQuery =
      intent.family === 'other' && baseQueryTokens.length > 0 &&
      baseQueryTokens.every((qt) => itemTokens.slice(0, baseQueryTokens.length + 1).some((t) => tokenMatches(t, qt)));
    if (fromCategory && hides(fromCategory) && !(titleIsTheQuery && (fromCategory === 'part' || fromCategory === 'accessory'))) {
      return fromCategory;
    }

    // 3. A pure car/device search: sites and categories that cannot hold the product
    if (intent.pure && intent.wants.size === 0) {
      if (intent.family === 'vehicle') {
        if (NO_VEHICLE_SOURCES.has(listing.source)) return 'accessory';
        if (listing.category && !isVehicleCategory(listing.category)) return 'accessory';
      }
      if (intent.family === 'device' && NO_DEVICE_SOURCES.has(listing.source)) return 'accessory';
    }

    // 4. Title words: toys, then parts/accessories/games for this kind of search
    if (hides('toy') && (
      titleTokens.some((t) => matchesAny(t, TOY_NOUNS)) ||
      TOY_PHRASES.test(title) ||
      SCALE_RE.test(listing.title.toLowerCase())
    )) return 'toy';

    for (const [nouns, kind, leadOnly] of contextNouns) {
      if (!hides(kind)) continue;
      const opts = leadOnly ? { leadOnly, leadWindow: 3 } : {};
      if (isAccessoryForQuery(itemTokens, queryTokens, nouns, forPrepositions, opts)) return kind;
    }

    // 4b. "<something> na/pro <the whole query>" — made for the product, not
    // the product: "Helma na horské kolo", "Dres na horské kolo", "Taška na
    // kočárek". Needs no noun list, so it works for any search.
    if (hides('accessory') && isMadeForQuery(itemTokens, baseQueryTokens, forPrepositions)) {
      return 'accessory';
    }

    // 5. Priced far below any real car
    if (
      intent.family === 'vehicle' && intent.pure && intent.wants.size === 0 && tooCheapBelow != null &&
      listing.price != null && listing.price > 10 && listing.price < tooCheapBelow
    ) return 'accessory';
    return null;
  };

  const byWordsAndCategory = (listing: ListingLike): ListingKind | null => {
    const kind = classify(listing);
    if (kind && PRICE_RESCUABLE.has(kind) && pricedLikeProduct(listing)) return null;
    return kind;
  };

  // Price of the pinned model itself: listings that name the model and that
  // nothing above marked as a part, accessory or game. Pattern prices (1,
  // 1 234) are placeholders for "price in the text" — left out here and left
  // alone below; the price check deals with them.
  const realPrice = (l: ListingLike) => l.price != null && l.price > 10 && !isPatternPrice(l.price);
  const modelPrices = matcher.pinned && intent.wants.size === 0
    ? listings
        .filter((l) =>
          realPrice(l) && matcher.signature(l.title).model === 'match' && byWordsAndCategory(l) === null)
        .map((l) => l.price as number)
        .sort((a, b) => a - b)
    : [];
  const farBelowModel =
    modelPrices.length >= MIN_MODEL_LISTINGS
      ? modelPrices[Math.floor((modelPrices.length - 1) * 0.75)] * FAR_BELOW_MODEL_SHARE
      : null;

  const filter = (listing: ListingLike): ListingKind | null => {
    const kind = byWordsAndCategory(listing);
    if (kind) return kind;
    // 6. Priced far below the pinned model
    if (farBelowModel != null && realPrice(listing) && (listing.price as number) < farBelowModel) {
      return 'accessory';
    }
    return null;
  };
  return Object.assign(filter, { pricedLikeProduct, matcher });
}
