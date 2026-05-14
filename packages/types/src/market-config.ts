import type { Source } from './index';

export type MarketId =
  | 'cz' | 'pl' | 'de' | 'at'
  | 'sk' | 'ro' | 'fr' | 'es' | 'nl' | 'gb' | 'it' | 'be' | 'se' | 'hu';
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

export const skMarket: MarketConfig = {
  id: 'sk',
  locale: 'sk-SK',
  currency: 'EUR',
  priceBucketSize: 50,
  minPlausiblePrice: 1,
  spamPatterns: [
    /\btel\.?\s*[:.]?\s*\d{9,}/i,
    /whatsapp/i,
    /telegram/i,
    /call me/i,
  ],
  stopwords: [],
  accessoryHeadNouns: [],
  forPrepositions: [],
  conditionSignals: {
    new: ['nový', 'nová', 'nové', 'nepoužívaný', 'nepoužívaná', 'nerozbalený', 'nový tovar'],
    like_new: ['ako nový', 'ako nová', 'veľmi dobrý stav', 'zánovný', 'zánovná'],
    good: ['dobrý stav', 'dobrá kondícia', 'zachovalý', 'funkčný', 'používaný'],
    fair: ['viditeľné stopy', 'škrabance', 'opotrebovaný', 'odreniny'],
    poor: ['poškodený', 'nefunkčný', 'na náhradné diely', 'na opravu', 'rozbitý'],
  },
  relativeDateRules: [
    { pattern: /pred (\d+) minút/i, unitMs: 60_000 },
    { pattern: /pred (\d+) hodin/i, unitMs: 3_600_000 },
    { pattern: /pred hodinou/i, unitMs: 3_600_000, defaultValue: 1 },
    { pattern: /pred (\d+) dňami/i, unitMs: 86_400_000 },
    { pattern: /pred dňom/i, unitMs: 86_400_000, defaultValue: 1 },
    { pattern: /pred (\d+) týždň/i, unitMs: 604_800_000 },
    { pattern: /pred týždňom/i, unitMs: 604_800_000, defaultValue: 1 },
    { pattern: /pred (\d+) mesiac/i, unitMs: 2_592_000_000 },
  ],
  sourceOptions: [
    { id: 'bazos_sk', label: 'Bazoš.sk', badge: 'full' },
    { id: 'vinted', label: 'Vinted', badge: 'partial' },
  ],
  sourceLabels: {
    bazos_sk: 'Bazoš.sk',
    vinted: 'Vinted',
    mock: 'Demo',
  },
  searchSuggestions: [
    'iPhone 13 128GB',
    'horský bicykel',
    'zimná bunda',
    'MacBook Pro',
    'PlayStation 5',
    'detský kočík',
  ],
  texts: {
    appName: 'Druhá Šanca',
    title: 'Druhá Šanca – bazárové ponuky',
    description: 'Nájdeme najlepšie bazárové ponuky na Bazoši a Vinted a zoradíme ich podľa skutočnej hodnoty.',
    heroBadge: 'Beta · Bazoš.sk · Vinted',
    tagline: 'Nájdeme najlepšie ponuky na Bazoši a Vinted a zoradíme ich podľa skutočnej hodnoty.',
    searchPlaceholder: 'Čo hľadáte? Napr. iPhone 13, bicykel, zimná bunda...',
    emptyStateTitle: 'Napíšte čo hľadáte',
    emptyStateBody: 'Prehľadáme Bazoš.sk a Vinted naraz.',
    noResultsTitle: 'Žiadne výsledky',
    noResultsBody: 'Skúste iné kľúčové slovo alebo upravte filtre.',
    feedbackButton: 'Spätná väzba',
    footer: 'Druhá Šanca · Beta · Dáta z tretích strán, len pre informáciu',
  },
};

export const roMarket: MarketConfig = {
  id: 'ro',
  locale: 'ro-RO',
  currency: 'RON',
  priceBucketSize: 500,
  minPlausiblePrice: 5,
  spamPatterns: [
    /\btel\.?\s*[:.]?\s*\d{9,}/i,
    /whatsapp/i,
    /telegram/i,
    /call me/i,
  ],
  stopwords: [],
  accessoryHeadNouns: [],
  forPrepositions: [],
  conditionSignals: {
    new: ['nou', 'nouă', 'sigilat', 'nefolosit', 'nefolosită'],
    like_new: ['ca nou', 'ca nouă', 'stare foarte bună', 'impecabil'],
    good: ['stare bună', 'funcțional', 'îngrijit', 'folosit puțin'],
    fair: ['urme de utilizare', 'zgârieturi', 'uzat'],
    poor: ['defect', 'nefuncțional', 'pentru piese', 'pentru reparație', 'spart'],
  },
  relativeDateRules: [
    { pattern: /acum (\d+) minute/i, unitMs: 60_000 },
    { pattern: /acum (\d+) ore/i, unitMs: 3_600_000 },
    { pattern: /acum o oră/i, unitMs: 3_600_000, defaultValue: 1 },
    { pattern: /acum (\d+) zile/i, unitMs: 86_400_000 },
    { pattern: /ieri/i, unitMs: 86_400_000, defaultValue: 1 },
    { pattern: /acum (\d+) săptămâni/i, unitMs: 604_800_000 },
  ],
  sourceOptions: [
    { id: 'olx_ro', label: 'OLX.ro', badge: 'full' },
    { id: 'vinted', label: 'Vinted', badge: 'partial' },
  ],
  sourceLabels: {
    olx_ro: 'OLX.ro',
    vinted: 'Vinted',
    mock: 'Demo',
  },
  searchSuggestions: [
    'iPhone 13 128GB',
    'bicicletă munte',
    'geacă de iarnă',
    'MacBook Pro',
    'PlayStation 5',
    'cărucior copil',
  ],
  texts: {
    appName: 'La Mâna a Doua',
    title: 'La Mâna a Doua – oferte second hand',
    description: 'Găsim cele mai bune oferte second hand pe OLX și Vinted și le ordonăm după valoarea reală.',
    heroBadge: 'Beta · OLX.ro · Vinted',
    tagline: 'Găsim cele mai bune oferte pe OLX și Vinted și le ordonăm după valoarea reală.',
    searchPlaceholder: 'Ce căutați? Ex. iPhone 13, bicicletă, geacă de iarnă...',
    emptyStateTitle: 'Scrieți ce căutați',
    emptyStateBody: 'Căutăm pe OLX.ro și Vinted simultan.',
    noResultsTitle: 'Niciun rezultat',
    noResultsBody: 'Încercați alt cuvânt cheie sau modificați filtrele.',
    feedbackButton: 'Feedback',
    footer: 'La Mâna a Doua · Beta · Date de la terți, doar cu titlu informativ',
  },
};

export const frMarket: MarketConfig = {
  id: 'fr',
  locale: 'fr-FR',
  currency: 'EUR',
  priceBucketSize: 50,
  minPlausiblePrice: 1,
  spamPatterns: [
    /\btel\.?\s*[:.]?\s*\d{9,}/i,
    /whatsapp/i,
    /telegram/i,
    /call me/i,
  ],
  stopwords: ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'en', 'au', 'aux'],
  accessoryHeadNouns: [
    'étui', 'coque', 'housse', 'film', 'protège', 'chargeur', 'câble', 'adaptateur',
    'support', 'bracelet', 'écouteurs', 'enceinte',
  ],
  forPrepositions: ['pour', 'compatible', 'de'],
  conditionSignals: {
    new: ['neuf', 'neuve', 'nouveau', 'nouvelle', 'jamais utilisé', 'sous blister', 'scellé'],
    like_new: ['comme neuf', 'quasi neuf', 'parfait état', 'état impeccable', 'très bon état'],
    good: ['bon état', 'très bien', 'fonctionne parfaitement', 'peu utilisé', 'bien entretenu'],
    fair: ['traces d\'usure', 'rayures', 'légèrement abîmé', 'usé'],
    poor: ['défectueux', 'en panne', 'pour pièces', 'à réparer', 'cassé', 'hs'],
  },
  relativeDateRules: [
    { pattern: /il y a (\d+) minute/i, unitMs: 60_000 },
    { pattern: /il y a (\d+) heure/i, unitMs: 3_600_000 },
    { pattern: /il y a une heure/i, unitMs: 3_600_000, defaultValue: 1 },
    { pattern: /il y a (\d+) jour/i, unitMs: 86_400_000 },
    { pattern: /hier/i, unitMs: 86_400_000, defaultValue: 1 },
    { pattern: /il y a (\d+) semaine/i, unitMs: 604_800_000 },
  ],
  sourceOptions: [
    { id: 'leboncoin', label: 'LeBonCoin', badge: 'full' },
    { id: 'vinted', label: 'Vinted', badge: 'full' },
  ],
  sourceLabels: {
    leboncoin: 'LeBonCoin',
    vinted: 'Vinted',
    mock: 'Demo',
  },
  searchSuggestions: [
    'iPhone 13 128GB',
    'vélo de montagne',
    'veste d\'hiver',
    'MacBook Pro',
    'PlayStation 5',
    'poussette bébé',
  ],
  texts: {
    appName: 'Occasion Malin',
    title: 'Occasion Malin – meilleures occasions',
    description: 'Trouvez les meilleures occasions sur LeBonCoin et Vinted. Triées par valeur réelle.',
    heroBadge: 'Bêta · LeBonCoin · Vinted',
    tagline: 'Trouvez les meilleures occasions sur LeBonCoin et Vinted — triées par valeur réelle.',
    searchPlaceholder: 'Que cherchez-vous ? Ex. iPhone 13, vélo, veste d\'hiver...',
    emptyStateTitle: 'Tapez ce que vous cherchez',
    emptyStateBody: 'Nous cherchons sur LeBonCoin et Vinted en même temps.',
    noResultsTitle: 'Aucun résultat',
    noResultsBody: 'Essayez un autre mot-clé ou modifiez les filtres.',
    feedbackButton: 'Avis',
    footer: 'Occasion Malin · Bêta · Données de tiers, à titre informatif uniquement',
  },
};

export const esMarket: MarketConfig = {
  id: 'es',
  locale: 'es-ES',
  currency: 'EUR',
  priceBucketSize: 50,
  minPlausiblePrice: 1,
  spamPatterns: [/whatsapp/i, /telegram/i, /call me/i],
  stopwords: ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'y', 'a', 'por'],
  accessoryHeadNouns: ['funda', 'carcasa', 'protector', 'cargador', 'cable', 'auriculares'],
  forPrepositions: ['para', 'compatible'],
  conditionSignals: {
    new: ['nuevo', 'nueva', 'sin usar', 'precintado', 'sellado', 'a estrenar'],
    like_new: ['como nuevo', 'como nueva', 'impecable', 'perfecto estado', 'muy buen estado'],
    good: ['buen estado', 'bien conservado', 'funciona perfectamente', 'poco uso'],
    fair: ['marcas de uso', 'algún arañazo', 'desgastado', 'usado'],
    poor: ['defectuoso', 'no funciona', 'para piezas', 'roto', 'averiado'],
  },
  relativeDateRules: [
    { pattern: /hace (\d+) minuto/i, unitMs: 60_000 },
    { pattern: /hace (\d+) hora/i, unitMs: 3_600_000 },
    { pattern: /hace (\d+) día/i, unitMs: 86_400_000 },
    { pattern: /ayer/i, unitMs: 86_400_000, defaultValue: 1 },
    { pattern: /hace (\d+) semana/i, unitMs: 604_800_000 },
  ],
  sourceOptions: [
    { id: 'wallapop', label: 'Wallapop', badge: 'full' },
    { id: 'vinted', label: 'Vinted', badge: 'full' },
  ],
  sourceLabels: { wallapop: 'Wallapop', vinted: 'Vinted', mock: 'Demo' },
  searchSuggestions: ['iPhone 13 128GB', 'bicicleta montaña', 'chaqueta invierno', 'MacBook Pro', 'PlayStation 5', 'silla de paseo'],
  texts: {
    appName: 'Segunda Mano Pro',
    title: 'Segunda Mano Pro – mejores ofertas',
    description: 'Encontramos las mejores ofertas de segunda mano en Wallapop y Vinted. Ordenadas por valor real.',
    heroBadge: 'Beta · Wallapop · Vinted',
    tagline: 'Encontramos las mejores ofertas en Wallapop y Vinted — ordenadas por valor real.',
    searchPlaceholder: '¿Qué buscas? Ej. iPhone 13, bicicleta, chaqueta...',
    emptyStateTitle: 'Escribe qué buscas',
    emptyStateBody: 'Buscamos en Wallapop y Vinted a la vez.',
    noResultsTitle: 'Sin resultados',
    noResultsBody: 'Prueba con otra palabra clave o cambia los filtros.',
    feedbackButton: 'Opiniones',
    footer: 'Segunda Mano Pro · Beta · Datos de terceros, solo informativo',
  },
};

export const nlMarket: MarketConfig = {
  id: 'nl',
  locale: 'nl-NL',
  currency: 'EUR',
  priceBucketSize: 50,
  minPlausiblePrice: 1,
  spamPatterns: [/whatsapp/i, /telegram/i, /bel me/i],
  stopwords: ['de', 'het', 'een', 'van', 'in', 'op', 'en', 'te', 'voor', 'met'],
  accessoryHeadNouns: ['hoesje', 'beschermhoes', 'oplader', 'kabel', 'adapter', 'standaard'],
  forPrepositions: ['voor', 'compatible'],
  conditionSignals: {
    new: ['nieuw', 'ongebruikt', 'in doos', 'sealed', 'ongeopend'],
    like_new: ['zo goed als nieuw', 'als nieuw', 'uitstekende staat', 'perfecte staat'],
    good: ['goede staat', 'nette staat', 'weinig gebruikt', 'goed onderhouden'],
    fair: ['gebruikssporen', 'krassen', 'lichte slijtage'],
    poor: ['defect', 'kapot', 'voor onderdelen', 'ter reparatie'],
  },
  relativeDateRules: [
    { pattern: /(\d+) minuten? geleden/i, unitMs: 60_000 },
    { pattern: /(\d+) uur geleden/i, unitMs: 3_600_000 },
    { pattern: /(\d+) dag(?:en)? geleden/i, unitMs: 86_400_000 },
    { pattern: /gisteren/i, unitMs: 86_400_000, defaultValue: 1 },
    { pattern: /vandaag/i, unitMs: 0, defaultValue: 0 },
    { pattern: /(\d+) wek?en? geleden/i, unitMs: 604_800_000 },
  ],
  sourceOptions: [
    { id: 'marktplaats', label: 'Marktplaats', badge: 'full' },
    { id: 'vinted', label: 'Vinted', badge: 'full' },
  ],
  sourceLabels: { marktplaats: 'Marktplaats', vinted: 'Vinted', mock: 'Demo' },
  searchSuggestions: ['iPhone 13 128GB', 'mountainbike', 'winterjas', 'MacBook Pro', 'PlayStation 5', 'kinderwagen'],
  texts: {
    appName: 'Tweedehands Tip',
    title: 'Tweedehands Tip – beste tweedehands deals',
    description: 'Vind de beste tweedehands aanbiedingen op Marktplaats en Vinted. Gesorteerd op echte waarde.',
    heroBadge: 'Beta · Marktplaats · Vinted',
    tagline: 'Vind de beste aanbiedingen op Marktplaats en Vinted — gesorteerd op echte waarde.',
    searchPlaceholder: 'Wat zoek je? Bijv. iPhone 13, fiets, winterjas...',
    emptyStateTitle: 'Typ wat je zoekt',
    emptyStateBody: 'We zoeken op Marktplaats en Vinted tegelijk.',
    noResultsTitle: 'Geen resultaten',
    noResultsBody: 'Probeer een ander zoekwoord of pas de filters aan.',
    feedbackButton: 'Feedback',
    footer: 'Tweedehands Tip · Beta · Data van derden, alleen ter informatie',
  },
};

export const gbMarket: MarketConfig = {
  id: 'gb',
  locale: 'en-GB',
  currency: 'GBP',
  priceBucketSize: 50,
  minPlausiblePrice: 1,
  spamPatterns: [/whatsapp/i, /telegram/i, /call me/i, /text me/i],
  stopwords: ['the', 'a', 'an', 'of', 'for', 'in', 'on', 'and', 'or', 'to', 'with'],
  accessoryHeadNouns: ['case', 'cover', 'screen protector', 'charger', 'cable', 'adapter', 'stand'],
  forPrepositions: ['for', 'compatible'],
  conditionSignals: {
    new: ['new', 'brand new', 'sealed', 'unopened', 'unused', 'mint'],
    like_new: ['like new', 'nearly new', 'as new', 'perfect condition', 'excellent condition'],
    good: ['good condition', 'very good', 'fully working', 'well maintained', 'lightly used'],
    fair: ['some wear', 'light scratches', 'signs of use', 'fair condition'],
    poor: ['faulty', 'broken', 'for parts', 'spares or repair', 'not working'],
  },
  relativeDateRules: [
    { pattern: /(\d+) minutes? ago/i, unitMs: 60_000 },
    { pattern: /(\d+) hours? ago/i, unitMs: 3_600_000 },
    { pattern: /(\d+) days? ago/i, unitMs: 86_400_000 },
    { pattern: /yesterday/i, unitMs: 86_400_000, defaultValue: 1 },
    { pattern: /today/i, unitMs: 0, defaultValue: 0 },
    { pattern: /(\d+) weeks? ago/i, unitMs: 604_800_000 },
  ],
  sourceOptions: [
    { id: 'gumtree', label: 'Gumtree', badge: 'full' },
    { id: 'vinted', label: 'Vinted', badge: 'full' },
    { id: 'shpock', label: 'Shpock', badge: 'partial' },
  ],
  sourceLabels: { gumtree: 'Gumtree', vinted: 'Vinted', shpock: 'Shpock', mock: 'Demo' },
  searchSuggestions: ['iPhone 13 128GB', 'mountain bike', 'winter jacket', 'MacBook Pro', 'PlayStation 5', 'pushchair'],
  texts: {
    appName: 'Secondhand Scout',
    title: 'Secondhand Scout – best used deals in the UK',
    description: 'Find the best secondhand deals on Gumtree, Vinted and Shpock. Ranked by real value.',
    heroBadge: 'Beta · Gumtree · Vinted · Shpock',
    tagline: 'Find the best deals on Gumtree, Vinted and Shpock — ranked by real value.',
    searchPlaceholder: 'What are you looking for? E.g. iPhone 13, bike, winter jacket...',
    emptyStateTitle: 'Type what you\'re looking for',
    emptyStateBody: 'We search Gumtree, Vinted and Shpock at the same time.',
    noResultsTitle: 'No results',
    noResultsBody: 'Try a different keyword or adjust the filters.',
    feedbackButton: 'Feedback',
    footer: 'Secondhand Scout · Beta · Data from third parties, for information only',
  },
};

export const itMarket: MarketConfig = {
  id: 'it',
  locale: 'it-IT',
  currency: 'EUR',
  priceBucketSize: 50,
  minPlausiblePrice: 1,
  spamPatterns: [/whatsapp/i, /telegram/i, /chiama/i],
  stopwords: ['il', 'la', 'i', 'le', 'un', 'una', 'di', 'del', 'della', 'in', 'e', 'a'],
  accessoryHeadNouns: ['custodia', 'cover', 'protezione', 'caricatore', 'cavo', 'adattatore'],
  forPrepositions: ['per', 'compatibile'],
  conditionSignals: {
    new: ['nuovo', 'nuova', 'nuovo di zecca', 'mai usato', 'sigillato', 'imballato'],
    like_new: ['come nuovo', 'come nuova', 'perfette condizioni', 'ottime condizioni', 'mai aperto'],
    good: ['buone condizioni', 'ottimo stato', 'funzionante', 'poco usato', 'ben tenuto'],
    fair: ['segni di usura', 'graffi', 'usato'],
    poor: ['difettoso', 'non funziona', 'per pezzi', 'da riparare', 'rotto'],
  },
  relativeDateRules: [
    { pattern: /(\d+) minut/i, unitMs: 60_000 },
    { pattern: /(\d+) or/i, unitMs: 3_600_000 },
    { pattern: /(\d+) giorn/i, unitMs: 86_400_000 },
    { pattern: /ieri/i, unitMs: 86_400_000, defaultValue: 1 },
    { pattern: /oggi/i, unitMs: 0, defaultValue: 0 },
    { pattern: /(\d+) settiman/i, unitMs: 604_800_000 },
  ],
  sourceOptions: [
    { id: 'subito', label: 'Subito.it', badge: 'full' },
    { id: 'vinted', label: 'Vinted', badge: 'full' },
  ],
  sourceLabels: { subito: 'Subito.it', vinted: 'Vinted', mock: 'Demo' },
  searchSuggestions: ['iPhone 13 128GB', 'bici da montagna', 'giacca invernale', 'MacBook Pro', 'PlayStation 5', 'passeggino'],
  texts: {
    appName: 'Affare Fatto',
    title: 'Affare Fatto – migliori occasioni usato',
    description: 'Trova le migliori occasioni su Subito.it e Vinted. Ordinate per valore reale.',
    heroBadge: 'Beta · Subito.it · Vinted',
    tagline: 'Trova le migliori occasioni su Subito.it e Vinted — ordinate per valore reale.',
    searchPlaceholder: 'Cosa cerchi? Es. iPhone 13, bici, giacca invernale...',
    emptyStateTitle: 'Scrivi cosa cerchi',
    emptyStateBody: 'Cerchiamo su Subito.it e Vinted contemporaneamente.',
    noResultsTitle: 'Nessun risultato',
    noResultsBody: 'Prova un\'altra parola chiave o modifica i filtri.',
    feedbackButton: 'Feedback',
    footer: 'Affare Fatto · Beta · Dati di terze parti, solo a scopo informativo',
  },
};

export const beMarket: MarketConfig = {
  id: 'be',
  locale: 'fr-BE',
  currency: 'EUR',
  priceBucketSize: 50,
  minPlausiblePrice: 1,
  spamPatterns: [/whatsapp/i, /telegram/i, /call me/i],
  stopwords: ['le', 'la', 'les', 'de', 'un', 'une', 'en', 'et', 'du'],
  accessoryHeadNouns: ['étui', 'coque', 'chargeur', 'câble'],
  forPrepositions: ['pour', 'compatible'],
  conditionSignals: {
    new: ['neuf', 'nieuw', 'jamais utilisé', 'ongebruikt', 'sealed', 'nieuw in doos'],
    like_new: ['comme neuf', 'als nieuw', 'parfait état'],
    good: ['bon état', 'goede staat', 'peu utilisé', 'weinig gebruikt'],
    fair: ['traces d\'usure', 'gebruikssporen'],
    poor: ['défectueux', 'defect', 'pour pièces'],
  },
  relativeDateRules: [
    { pattern: /il y a (\d+) minute/i, unitMs: 60_000 },
    { pattern: /(\d+) minuten? geleden/i, unitMs: 60_000 },
    { pattern: /il y a (\d+) heure/i, unitMs: 3_600_000 },
    { pattern: /(\d+) uur geleden/i, unitMs: 3_600_000 },
    { pattern: /il y a (\d+) jour/i, unitMs: 86_400_000 },
    { pattern: /(\d+) dag(?:en)? geleden/i, unitMs: 86_400_000 },
    { pattern: /hier|gisteren/i, unitMs: 86_400_000, defaultValue: 1 },
  ],
  sourceOptions: [
    { id: 'tweedehands', label: '2dehands.be', badge: 'full' },
    { id: 'vinted', label: 'Vinted', badge: 'full' },
  ],
  sourceLabels: { tweedehands: '2dehands.be', vinted: 'Vinted', mock: 'Demo' },
  searchSuggestions: ['iPhone 13 128GB', 'mountainbike', 'winterjas', 'MacBook Pro', 'PlayStation 5', 'kinderwagen'],
  texts: {
    appName: 'Bon Plan Be',
    title: 'Bon Plan Be – meilleures occasions',
    description: 'Trouvez les meilleures occasions sur 2dehands.be et Vinted. Triées par valeur réelle.',
    heroBadge: 'Beta · 2dehands.be · Vinted',
    tagline: 'Trouvez les meilleures occasions sur 2dehands.be et Vinted — triées par valeur réelle.',
    searchPlaceholder: 'Que cherchez-vous ? Ex. iPhone 13, vélo, veste...',
    emptyStateTitle: 'Tapez ce que vous cherchez',
    emptyStateBody: 'Nous cherchons sur 2dehands.be et Vinted en même temps.',
    noResultsTitle: 'Aucun résultat',
    noResultsBody: 'Essayez un autre mot-clé ou modifiez les filtres.',
    feedbackButton: 'Avis',
    footer: 'Bon Plan Be · Beta · Données de tiers, à titre informatif uniquement',
  },
};

export const seMarket: MarketConfig = {
  id: 'se',
  locale: 'sv-SE',
  currency: 'SEK',
  priceBucketSize: 500,
  minPlausiblePrice: 10,
  spamPatterns: [/whatsapp/i, /telegram/i, /ring mig/i],
  stopwords: ['och', 'i', 'en', 'ett', 'av', 'på', 'med', 'för', 'till', 'är'],
  accessoryHeadNouns: ['fodral', 'skal', 'laddare', 'kabel', 'skärmskydd', 'hörlurar'],
  forPrepositions: ['för', 'till', 'kompatibel'],
  conditionSignals: {
    new: ['ny', 'nytt', 'oanvänd', 'oöppnad', 'fabriksny', 'i originalförpackning'],
    like_new: ['som ny', 'som nytt', 'perfekt skick', 'utmärkt skick', 'mycket gott skick'],
    good: ['bra skick', 'gott skick', 'lite använd', 'välvårdad', 'fungerar perfekt'],
    fair: ['slitna', 'repor', 'bruksslitage', 'används'],
    poor: ['trasig', 'fungerar ej', 'för delar', 'reparationsobjekt', 'defekt'],
  },
  relativeDateRules: [
    { pattern: /(\d+) minut(?:er)? sedan/i, unitMs: 60_000 },
    { pattern: /(\d+) timm(?:ar)? sedan/i, unitMs: 3_600_000 },
    { pattern: /(\d+) dag(?:ar)? sedan/i, unitMs: 86_400_000 },
    { pattern: /igår/i, unitMs: 86_400_000, defaultValue: 1 },
    { pattern: /idag/i, unitMs: 0, defaultValue: 0 },
    { pattern: /(\d+) veck(?:or)? sedan/i, unitMs: 604_800_000 },
  ],
  sourceOptions: [
    { id: 'blocket', label: 'Blocket', badge: 'full' },
    { id: 'vinted', label: 'Vinted', badge: 'full' },
  ],
  sourceLabels: { blocket: 'Blocket', vinted: 'Vinted', mock: 'Demo' },
  searchSuggestions: ['iPhone 13 128GB', 'mountainbike', 'vinterjacka', 'MacBook Pro', 'PlayStation 5', 'barnvagn'],
  texts: {
    appName: 'Begagnat Fynd',
    title: 'Begagnat Fynd – bästa begagnade fynd',
    description: 'Hitta de bästa begagnade erbjudandena på Blocket och Vinted. Sorterade efter verkligt värde.',
    heroBadge: 'Beta · Blocket · Vinted',
    tagline: 'Hitta de bästa erbjudandena på Blocket och Vinted — sorterade efter verkligt värde.',
    searchPlaceholder: 'Vad letar du efter? T.ex. iPhone 13, cykel, vinterjacka...',
    emptyStateTitle: 'Skriv vad du letar efter',
    emptyStateBody: 'Vi söker på Blocket och Vinted samtidigt.',
    noResultsTitle: 'Inga resultat',
    noResultsBody: 'Prova ett annat sökord eller justera filtren.',
    feedbackButton: 'Feedback',
    footer: 'Begagnat Fynd · Beta · Data från tredje part, endast för information',
  },
};

export const huMarket: MarketConfig = {
  id: 'hu',
  locale: 'hu-HU',
  currency: 'HUF',
  priceBucketSize: 5000,
  minPlausiblePrice: 100,
  spamPatterns: [/whatsapp/i, /telegram/i, /hívj fel/i],
  stopwords: ['a', 'az', 'és', 'vagy', 'de', 'hogy', 'egy', 'be', 'ki', 'el'],
  accessoryHeadNouns: ['tok', 'védőtok', 'töltő', 'kábel', 'adapter', 'tartó'],
  forPrepositions: ['hoz', 'hez', 'höz', 'kompatibilis'],
  conditionSignals: {
    new: ['új', 'bontatlan', 'soha nem használt', 'eredeti csomagolásban', 'gyári'],
    like_new: ['mint az új', 'kitűnő állapot', 'kiváló állapot', 'alig használt'],
    good: ['jó állapot', 'jól karbantartott', 'működőképes', 'keveset használt'],
    fair: ['kopásnyomok', 'karcolások', 'használt'],
    poor: ['hibás', 'nem működik', 'alkatrésznek', 'javításra szorul', 'törött'],
  },
  relativeDateRules: [
    { pattern: /(\d+) perce/i, unitMs: 60_000 },
    { pattern: /(\d+) perccel/i, unitMs: 60_000 },
    { pattern: /(\d+) órája/i, unitMs: 3_600_000 },
    { pattern: /(\d+) órával/i, unitMs: 3_600_000 },
    { pattern: /(\d+) napja/i, unitMs: 86_400_000 },
    { pattern: /tegnap/i, unitMs: 86_400_000, defaultValue: 1 },
    { pattern: /ma/i, unitMs: 0, defaultValue: 0 },
    { pattern: /(\d+) hete/i, unitMs: 604_800_000 },
  ],
  sourceOptions: [
    { id: 'jofogas', label: 'Jófogás', badge: 'full' },
    { id: 'vinted', label: 'Vinted', badge: 'full' },
  ],
  sourceLabels: { jofogas: 'Jófogás', vinted: 'Vinted', mock: 'Demo' },
  searchSuggestions: ['iPhone 13 128GB', 'hegyi kerékpár', 'téli kabát', 'MacBook Pro', 'PlayStation 5', 'babakocsi'],
  texts: {
    appName: 'Olcsón Megvesz',
    title: 'Olcsón Megvesz – legjobb használt ajánlatok',
    description: 'Találjuk meg a legjobb használt ajánlatokat a Jófogáson és Vinteden. Valódi érték szerint rendezve.',
    heroBadge: 'Béta · Jófogás · Vinted',
    tagline: 'A legjobb ajánlatokat keressük a Jófogáson és Vinteden — valódi érték szerint rendezve.',
    searchPlaceholder: 'Mit keres? Pl. iPhone 13, kerékpár, téli kabát...',
    emptyStateTitle: 'Írja be, mit keres',
    emptyStateBody: 'Egyszerre keresünk a Jófogáson és Vinteden.',
    noResultsTitle: 'Nincs találat',
    noResultsBody: 'Próbáljon más kulcsszót, vagy módosítsa a szűrőket.',
    feedbackButton: 'Visszajelzés',
    footer: 'Olcsón Megvesz · Béta · Harmadik féltől származó adatok, csak tájékoztató jelleggel',
  },
};

export function getMarketConfig(id: MarketId): MarketConfig {
  switch (id) {
    case 'pl': return plMarket;
    case 'at': return atMarket;
    case 'de': return deMarket;
    case 'sk': return skMarket;
    case 'ro': return roMarket;
    case 'fr': return frMarket;
    case 'es': return esMarket;
    case 'nl': return nlMarket;
    case 'gb': return gbMarket;
    case 'it': return itMarket;
    case 'be': return beMarket;
    case 'se': return seMarket;
    case 'hu': return huMarket;
    case 'cz':
    default:
      return czMarket;
  }
}
