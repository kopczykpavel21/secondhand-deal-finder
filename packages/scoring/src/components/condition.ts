import type { Condition } from '@sdf/types';

const CONDITION_SCORES: Record<Condition, number> = {
  new: 1.0,
  like_new: 0.85,
  good: 0.65,
  fair: 0.40,
  poor: 0.15,
  unknown: 0.35, // Assume imperfect rather than perfect when unknown
};

// ─── Condition signal lists ───────────────────────────────────────────────────
// All entries are lowercased. normalizeCondition() lowercases input before matching.
// Longer/more-specific phrases should come before shorter ones within lists so
// that "jako nový" isn't eclipsed by a partial hit on "nový".

const NEW_SIGNALS = [
  // Vinted structured label — tier 1 "Nový" (all genders, both tag wordings)
  'nový s visačkou', 'nová s visačkou', 'nové s visačkou',   // confirmed live label
  'nové se štítkem', 'nový se štítkem', 'nová se štítkem',   // alternative wording
  // Czech
  'nerozbalený', 'nerozbalená', 'nerozbalené',
  'zapečetěný', 'zapečetěná',
  'v záruční době', 'v záruce', 'záruční', 'záruka',
  'v krabici', 'boxed', 'sealed',
  // English
  'new', 'brand new', 'never used', 'unused',
];

const LIKE_NEW_SIGNALS = [
  // Vinted structured labels — tier 2 "Jako nový" / "Nový bez visačky" and tier 3 "Velmi dobrý"
  'nový bez visačky', 'nová bez visačky', 'nové bez visačky', // confirmed live label (tier 2)
  'jako nový', 'jako nová', 'jako nové',                      // generic like-new phrases
  'velmi dobrý', 'velmi dobrá', 'velmi dobré',                // Vinted tier 3
  // Czech — multi-word first
  'téměř nový', 'téměř nová', 'téměř nepoužitý',
  'skoro nový', 'skoro nová',
  'zánovní stav', 'bezvadný stav', 'skvělý stav',
  'výborný stav', 'perfektní stav', 'perfektní kondice',
  'výborná kondice', 'top stav', 'top kondice',
  'stav jako nový', 'stav jako nová',
  // Czech — single words
  'zánovní', 'zánovni', 'bezvadný', 'bezvadná',
  'perfektní', 'výborný', 'výborná',
  // English
  'like new', 'mint', 'mint condition', 'lightly used', 'barely used',
];

const GOOD_SIGNALS = [
  // Vinted structured label — tier 4 "Dobrý" (all genders)
  'dobrý', 'dobrá', 'dobré',
  // Czech — multi-word first
  'dobrý stav', 'dobrá kondice', 'hezký stav', 'pěkný stav',
  'funkční stav', 'plně funkční', 'bez závad', 'bez problémů',
  'bez vad', 'zachovalý stav', 'zachovalá',
  'opotřebení minimální', 'minimální opotřebení',
  'stav odpovídá stáří',
  // Czech — single words
  'zachovalý', 'zachovalá', 'zachovalé', 'funkční',
  'použitý', 'použitá', 'použité',
  // English
  'good condition', 'good', 'used', 'gently used', 'well maintained',
];

const FAIR_SIGNALS = [
  // Vinted structured label — tier 5 "Uspokojivý" (all genders)
  'uspokojivý', 'uspokojivá', 'uspokojivé',
  // Czech — multi-word first
  'drobné škrábance', 'drobné poškrábání', 'lehce poškrábané',
  'viditelné opotřebení', 'normální opotřebení', 'lehce opotřebovaný',
  'poškozený lehce', 'lehce poškozený', 'lehce poškozená',
  'stopy používání', 'stopy opotřebení',
  'kosmetické vady', 'kosmetická vada',
  // Czech — single words
  'ojetý', 'ojetá', 'opotřebovaný', 'opotřebovaná', 'opotřebované',
  // English
  'fair', 'fair condition', 'signs of wear', 'visible wear',
];

const POOR_SIGNALS = [
  // Vinted structured label — tier 6 "Potřebuje opravu" (electronics only)
  'potřebuje opravu',
  // Czech — multi-word first
  'na díly', 'na náhradní díly', 'ke opravě',
  'potřebuje servis', 'nefunkční displej', 'rozbitý displej',
  'prasklý displej', 'popraskané sklo', 'rozbité sklo',
  // Czech — single words
  'poškozený', 'poškozená', 'poškozené',
  'nefunkční', 'nefunkčný',
  'rozbité', 'rozbitý', 'rozbitá',
  'prasklé', 'prasklý', 'prasklá',
  'neúplné', 'neúplný',
  // English
  'damaged', 'broken', 'for parts', 'not working', 'faulty', 'cracked',
];

export function normalizeCondition(conditionText: string | null): Condition {
  if (!conditionText) return 'unknown';
  const lower = conditionText.toLowerCase();

  if (NEW_SIGNALS.some((s) => lower.includes(s))) return 'new';
  if (LIKE_NEW_SIGNALS.some((s) => lower.includes(s))) return 'like_new';
  if (POOR_SIGNALS.some((s) => lower.includes(s))) return 'poor';
  if (FAIR_SIGNALS.some((s) => lower.includes(s))) return 'fair';
  if (GOOD_SIGNALS.some((s) => lower.includes(s))) return 'good';

  return 'unknown';
}

export function scoreCondition(condition: Condition): number {
  return CONDITION_SCORES[condition];
}

export function conditionLabel(condition: Condition): string {
  const labels: Record<Condition, string> = {
    new: 'New',
    like_new: 'Like new',
    good: 'Good condition',
    fair: 'Fair condition',
    poor: 'Poor / for parts',
    unknown: 'Condition unknown',
  };
  return labels[condition];
}
