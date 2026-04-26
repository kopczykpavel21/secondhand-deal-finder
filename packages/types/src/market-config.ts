import type { Source } from './index';

export type MarketId = 'cz' | 'pl' | 'de' | 'at';
export type SourceBadge = 'full' | 'partial' | 'experimental';

export interface RelativeDateRule {
  pattern: RegExp;
  unitMs: number;
  defaultValue?: number;
}

export interface MarketTexts {
  appName: string;
  title: string;
  description: string;
  heroBadge: string;
  tagline: string;
  searchPlaceholder: string;
  emptyStateTitle: string;
  emptyStateBody: string;
  noResultsTitle: string;
  noResultsBody: string;
  feedbackButton: string;
  footer: string;
}

export interface MarketSourceOption {
  id: Source;
  label: string;
  badge: SourceBadge;
}

export interface MarketConfig {
  id: MarketId;
  locale: string;
  currency: string;
  priceBucketSize: number;
  minPlausiblePrice: number;
  spamPatterns: RegExp[];
  stopwords: string[];
  accessoryHeadNouns: string[];
  forPrepositions: string[];
  conditionSignals: {
    new: string[];
    like_new: string[];
    good: string[];
    fair: string[];
    poor: string[];
  };
  relativeDateRules: RelativeDateRule[];
  sourceOptions: MarketSourceOption[];
  sourceLabels: Partial<Record<Source, string>>;
  searchSuggestions: string[];
  texts: MarketTexts;
}

function prettifySource(source: Source): string {
  return source.replace(/_/g, ' ');
}

export function getSourceLabel(
  source: Source,
  market: Pick<MarketConfig, 'sourceLabels'>,
): string {
  return market.sourceLabels[source] ?? prettifySource(source);
}

export function parseRelativeDate(
  text: string | null | undefined,
  market: Pick<MarketConfig, 'relativeDateRules'>,
): Date | null {
  if (!text) return null;

  const lower = text.toLowerCase().trim();
  const now = Date.now();

  for (const rule of market.relativeDateRules) {
    const match = lower.match(rule.pattern);
    if (!match) continue;

    const value = match[1] ? parseInt(match[1], 10) : (rule.defaultValue ?? 1);
    if (!Number.isFinite(value)) continue;
    return new Date(now - value * rule.unitMs);
  }

  return null;
}

export const czMarket: MarketConfig = {
  id: 'cz',
  locale: 'cs-CZ',
  currency: 'CZK',
  priceBucketSize: 500,
  minPlausiblePrice: 12,
  spamPatterns: [
    /\btel\.?\s*[:.]?\s*\d{9,}/i,
    /whatsapp/i,
    /call me/i,
    /kontaktuj.{0,5}tel/i,
    /kup(uj|te) ted/i,
  ],
  stopwords: [],
  accessoryHeadNouns: [],
  forPrepositions: [],
  conditionSignals: { new: [], like_new: [], good: [], fair: [], poor: [] },
  relativeDateRules: [
    { pattern: /před (\d+) minut/i, unitMs: 60_000 },
    { pattern: /před (\d+) hodin/i, unitMs: 3_600_000 },
    { pattern: /před hodinou/i, unitMs: 3_600_000, defaultValue: 1 },
    { pattern: /před (\d+) dn/i, unitMs: 86_400_000 },
    { pattern: /před dnem/i, unitMs: 86_400_000, defaultValue: 1 },
    { pattern: /před (\d+) týdn/i, unitMs: 604_800_000 },
    { pattern: /před týdnem/i, unitMs: 604_800_000, defaultValue: 1 },
    { pattern: /před (\d+) měsíc/i, unitMs: 2_592_000_000 },
  ],
  sourceOptions: [
    { id: 'bazos', label: 'Bazoš', badge: 'full' },
    { id: 'vinted', label: 'Vinted', badge: 'partial' },
    { id: 'aukro', label: 'Aukro', badge: 'partial' },
    { id: 'fler', label: 'Fler', badge: 'partial' },
  ],
  sourceLabels: {
    bazos: 'Bazoš',
    sbazar: 'Sbazar',
    vinted: 'Vinted',
    facebook: 'Facebook',
    aukro: 'Aukro',
    fler: 'Fler',
    mock: 'Demo',
    willhaben: 'willhaben',
  },
  searchSuggestions: [
    'iPhone 13 128GB',
    'kolo horské',
    'zimní bunda',
    'MacBook Pro',
    'PlayStation 5',
    'dětský kočárek',
  ],
  texts: {
    appName: 'Secondhand Deal Finder',
    title: 'Secondhand Deal Finder',
    description: 'Najdeme nejlepší secondhand nabídky napříč bazary a seřadíme je podle skutečné hodnoty.',
    heroBadge: 'Beta · Bazoš · Vinted · Aukro · Fler',
    tagline: 'Najdeme nejlepší nabídky napříč bazary a seřadíme je podle skutečné hodnoty.',
    searchPlaceholder: 'Co hledáte? Např. iPhone 13, kolo, zimní bunda...',
    emptyStateTitle: 'Napište co hledáte',
    emptyStateBody: 'Prohledáme Bazoš, Vinted, Aukro a Fler najednou.',
    noResultsTitle: 'Žádné výsledky',
    noResultsBody: 'Zkuste jiné klíčové slovo nebo upravte filtry.',
    feedbackButton: 'Zpětná vazba',
    footer: 'Secondhand Deal Finder · MVP · Data ze třetích stran, pouze pro informaci',
  },
};

export const plMarket: MarketConfig = {
  id: 'pl',
  locale: 'pl-PL',
  currency: 'PLN',
  priceBucketSize: 100,
  minPlausiblePrice: 5,
  spamPatterns: [
    /\btel\.?\s*[:.]?\s*\d{9,}/i,
    /whatsapp/i,
    /telegram/i,
    /kontakt.{0,8}priv/i,
    /kup teraz/i,
  ],
  stopwords: [
    'a', 'i', 'o', 'u', 'w', 'z', 'na', 'za', 'do', 'od', 'po', 'dla',
    'jak', 'oraz', 'lub', 'ale', 'to', 'ten', 'ta', 'te', 'przy', 'bez',
  ],
  accessoryHeadNouns: [
    'etui', 'obudowa', 'pokrowiec', 'futeral', 'futerał', 'szklo', 'szkło',
    'folia', 'ladowarka', 'ładowarka', 'kabel', 'adapter', 'uchwyt', 'stojak',
    'pasek', 'bransoleta', 'sluchawki', 'słuchawki', 'glosnik', 'głośnik',
    'powerbank', 'oslona', 'osłona',
  ],
  forPrepositions: ['do', 'na', 'dla', 'pod', 'compatible', 'kompatybilny'],
  conditionSignals: {
    new: ['nowy', 'nowa', 'nowe', 'nieużywany', 'nieuzywany', 'z metką', 'zafoliowany'],
    like_new: ['jak nowy', 'jak nowa', 'stan idealny', 'bardzo dobry stan'],
    good: ['bardzo dobry', 'dobry stan', 'sprawny', 'zadbany', 'mało używany', 'malo uzywany'],
    fair: ['używany', 'uzywany', 'ślady użytkowania', 'slady uzytkowania', 'rysy', 'otarcia'],
    poor: ['uszkodzony', 'niesprawny', 'na części', 'na czesci', 'do naprawy', 'pęknięty', 'pekniety'],
  },
  relativeDateRules: [
    { pattern: /(\d+)\s*min.*temu/i, unitMs: 60_000 },
    { pattern: /godzinę temu/i, unitMs: 3_600_000, defaultValue: 1 },
    { pattern: /godzine temu/i, unitMs: 3_600_000, defaultValue: 1 },
    { pattern: /(\d+)\s*godz.*temu/i, unitMs: 3_600_000 },
    { pattern: /wczoraj/i, unitMs: 86_400_000, defaultValue: 1 },
    { pattern: /(\d+)\s*dni.*temu/i, unitMs: 86_400_000 },
    { pattern: /tydzień temu/i, unitMs: 604_800_000, defaultValue: 1 },
    { pattern: /tydzien temu/i, unitMs: 604_800_000, defaultValue: 1 },
    { pattern: /(\d+)\s*tyg.*temu/i, unitMs: 604_800_000 },
  ],
  sourceOptions: [
    { id: 'vinted', label: 'Vinted', badge: 'full' },
    { id: 'olx', label: 'OLX', badge: 'full' },
    { id: 'sprzedajemy', label: 'Sprzedajemy.pl', badge: 'full' },
  ],
  sourceLabels: {
    vinted: 'Vinted',
    olx: 'OLX',
    sprzedajemy: 'Sprzedajemy.pl',
    mock: 'Demo',
  },
  searchSuggestions: [
    'iPhone 13 128GB',
    'rower górski',
    'kurtka zimowa',
    'MacBook Pro',
    'PlayStation 5',
    'wózek dziecięcy',
  ],
  texts: {
    appName: 'Secondhand Okazje',
    title: 'Secondhand Okazje',
    description: 'Porównujemy oferty z OLX, Sprzedajemy.pl i Vinted i pokazujemy najlepsze okazje.',
    heroBadge: 'Beta · OLX · Sprzedajemy.pl · Vinted',
    tagline: 'Porównujemy oferty z OLX, Sprzedajemy.pl i Vinted i pokazujemy najlepsze okazje.',
    searchPlaceholder: 'Czego szukasz? Np. iPhone 13, rower, kurtka zimowa...',
    emptyStateTitle: 'Wpisz czego szukasz',
    emptyStateBody: 'Przeszukamy OLX, Sprzedajemy.pl i Vinted jednocześnie.',
    noResultsTitle: 'Brak wyników',
    noResultsBody: 'Spróbuj innego zapytania albo zmień filtry.',
    feedbackButton: 'Opinie',
    footer: 'Secondhand Okazje · MVP · Dane z zewnętrznych serwisów, wyłącznie informacyjnie',
  },
};

export const deMarket: MarketConfig = {
  id: 'de',
  locale: 'de-DE',
  currency: 'EUR',
  priceBucketSize: 50,
  minPlausiblePrice: 3,
  spamPatterns: [/whatsapp/i, /telegram/i, /call me/i],
  stopwords: [],
  accessoryHeadNouns: [],
  forPrepositions: [],
  conditionSignals: { new: [], like_new: [], good: [], fair: [], poor: [] },
  relativeDateRules: [
    { pattern: /vor (\d+) minuten/i, unitMs: 60_000 },
    { pattern: /vor (\d+) stunden/i, unitMs: 3_600_000 },
    { pattern: /vor einer stunde/i, unitMs: 3_600_000, defaultValue: 1 },
    { pattern: /vor (\d+) tagen/i, unitMs: 86_400_000 },
    { pattern: /gestern/i, unitMs: 86_400_000, defaultValue: 1 },
  ],
  sourceOptions: [
    { id: 'vinted', label: 'Vinted', badge: 'full' },
    { id: 'willhaben', label: 'willhaben', badge: 'full' },
    { id: 'kleinanzeigen', label: 'Kleinanzeigen', badge: 'full' },
  ],
  sourceLabels: {
    vinted: 'Vinted',
    willhaben: 'willhaben',
    kleinanzeigen: 'Kleinanzeigen',
    mock: 'Demo',
  },
  searchSuggestions: [
    'iPhone 13 128GB',
    'Fahrrad',
    'Winterjacke',
    'MacBook Pro',
    'PlayStation 5',
    'Kinderwagen',
  ],
  texts: {
    appName: 'Secondhand Schnäppchen Finder',
    title: 'Secondhand Schnäppchen Finder',
    description: 'Finde die besten Secondhand-Angebote auf Vinted, willhaben und Kleinanzeigen. Sortiert nach echtem Wert.',
    heroBadge: 'Beta · Vinted · willhaben · Kleinanzeigen',
    tagline: 'Finde die besten Angebote auf Vinted, willhaben und Kleinanzeigen – sortiert nach echtem Wert.',
    searchPlaceholder: 'Was suchen Sie? z. B. iPhone 13, Fahrrad, Winterjacke…',
    emptyStateTitle: 'Was suchen Sie?',
    emptyStateBody: 'Wir durchsuchen Vinted, willhaben und Kleinanzeigen gleichzeitig.',
    noResultsTitle: 'Keine Ergebnisse',
    noResultsBody: 'Versuche andere Suchbegriffe oder passe die Filter an.',
    feedbackButton: 'Feedback',
    footer: 'Secondhand Schnäppchen Finder · Beta · Daten von Drittanbietern, nur zur Information',
  },
};

export const atMarket: MarketConfig = {
  id: 'at',
  locale: 'de-AT',
  currency: 'EUR',
  priceBucketSize: 50,
  minPlausiblePrice: 3,
  spamPatterns: [/whatsapp/i, /telegram/i, /call me/i],
  stopwords: [],
  accessoryHeadNouns: [],
  forPrepositions: [],
  conditionSignals: { new: [], like_new: [], good: [], fair: [], poor: [] },
  relativeDateRules: [
    { pattern: /vor (\d+) minuten/i, unitMs: 60_000 },
    { pattern: /vor (\d+) stunden/i, unitMs: 3_600_000 },
    { pattern: /vor einer stunde/i, unitMs: 3_600_000, defaultValue: 1 },
    { pattern: /vor (\d+) tagen/i, unitMs: 86_400_000 },
    { pattern: /gestern/i, unitMs: 86_400_000, defaultValue: 1 },
  ],
  sourceOptions: [
    { id: 'vinted', label: 'Vinted', badge: 'full' },
    { id: 'willhaben', label: 'willhaben', badge: 'full' },
    { id: 'shpock', label: 'Shpock', badge: 'full' },
  ],
  sourceLabels: {
    vinted: 'Vinted',
    willhaben: 'willhaben',
    shpock: 'Shpock',
    mock: 'Demo',
  },
  searchSuggestions: [
    'iPhone 13 128GB',
    'Fahrrad',
    'Winterjacke',
    'MacBook Pro',
    'PlayStation 5',
    'Kinderwagen',
  ],
  texts: {
    appName: 'Secondhand Schnäppchen Finder Österreich',
    title: 'Secondhand Schnäppchen Finder Österreich',
    description: 'Finde die besten Secondhand-Angebote auf willhaben, Shpock und Vinted. Sortiert nach echtem Wert.',
    heroBadge: 'Beta · willhaben · Shpock · Vinted',
    tagline: 'Finde die besten Angebote auf willhaben, Shpock und Vinted – sortiert nach echtem Wert.',
    searchPlaceholder: 'Was suchen Sie? z. B. iPhone 13, Fahrrad, Winterjacke…',
    emptyStateTitle: 'Was suchen Sie?',
    emptyStateBody: 'Wir durchsuchen willhaben, Shpock und Vinted gleichzeitig.',
    noResultsTitle: 'Keine Ergebnisse',
    noResultsBody: 'Versuche andere Suchbegriffe oder passe die Filter an.',
    feedbackButton: 'Feedback',
    footer: 'Secondhand Schnäppchen Finder Österreich · Beta · Daten von Drittanbietern, nur zur Information',
  },
};

export function getMarketConfig(id: MarketId): MarketConfig {
  switch (id) {
    case 'pl':
      return plMarket;
    case 'at':
      return atMarket;
    case 'de':
      return deMarket;
    case 'cz':
    default:
      return czMarket;
  }
}
