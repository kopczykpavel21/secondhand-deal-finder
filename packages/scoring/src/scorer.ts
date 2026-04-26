import type {
  MarketConfig,
  NormalizedListing,
  ScoredListing,
  ScoringWeights,
  ScoreComponents,
} from '@sdf/types';
import { czMarket } from '@sdf/types';
import { DEFAULT_WEIGHTS } from './weights';
import { scoreRelevance } from './components/relevance';
import { scoreValueForMoney } from './components/value-for-money';
import { scoreCondition } from './components/condition';
import { scoreFreshness } from './components/freshness';
import { scoreCompleteness } from './components/completeness';
import { scoreSellerTrust } from './components/seller-trust';
import { scoreEngagement } from './components/engagement';

// ─── Spam / low-quality listing detection ────────────────────────────────────

/**
 * Returns true when the listing shows signs of spam, a repost scam,
 * or an implausible price that indicates a junk/test listing.
 * The spamPenalty weight is applied to the final score when this fires.
 */
function detectLowQuality(
  listing: NormalizedListing,
  market: Pick<MarketConfig, 'spamPatterns' | 'minPlausiblePrice'>,
): boolean {
  // Text-based spam signals
  const text = `${listing.title} ${listing.description ?? ''}`;
  if (market.spamPatterns.some((re) => re.test(text))) return true;

  // Suspiciously low price — likely a placeholder, misentry, or scam bait
  if (listing.price !== null && listing.price < market.minPlausiblePrice) return true;

  return false;
}

// ─── Explanation builder ──────────────────────────────────────────────────────

function buildExplanation(
  components: ScoreComponents,
  listing: NormalizedListing,
  weights: ScoringWeights,
  market: Pick<MarketConfig, 'id' | 'minPlausiblePrice'>,
): string[] {
  const lines: string[] = [];
  const isPolish = market.id === 'pl';

  if (components.relevance >= 0.8)
    lines.push(isPolish ? 'Bardzo dobra zgodność z wyszukiwanym hasłem.' : 'Výborná shoda s hledaným výrazem.');
  else if (components.relevance < 0.4)
    lines.push(isPolish ? 'Częściowa zgodność — brakuje części słów kluczowych.' : 'Částečná shoda — některá klíčová slova chybí.');

  if (weights.valueForMoney === 0) {
    lines.push(isPolish ? 'Cena nie była uwzględniona w ocenie.' : 'Cena nebyla při hodnocení zohledněna.');
  } else if (components.valueForMoney >= 0.7) {
    lines.push(isPolish ? 'Cena jest poniżej mediany dla tego wyszukiwania — wygląda na okazję.' : 'Cena je pod mediánem pro toto hledání — výhodná koupě.');
  } else if (components.valueForMoney <= 0.35) {
    lines.push(isPolish ? 'Cena jest powyżej mediany podobnych ofert.' : 'Cena je nad mediánem podobných inzerátů.');
  } else {
    lines.push(isPolish ? 'Cena jest zbliżona do średniej podobnych ofert.' : 'Cena odpovídá průměru podobných nabídek.');
  }

  if (components.condition >= 0.8)
    lines.push(isPolish ? 'Oferta wskazuje na nowy albo prawie nowy stan.' : 'Inzerát uvádí nový nebo skoro nový stav.');
  else if (components.condition <= 0.2)
    lines.push(isPolish ? 'Stan wygląda słabo albo przedmiot jest oferowany na części.' : 'Stav vypadá špatně nebo nabízeno na náhradní díly.');

  if (listing.promoted)
    lines.push(isPolish ? 'Świeżość jest neutralna — promowane oferty bywają odświeżane codziennie, więc prawdziwy wiek nie jest znany.' : 'Čerstvost je neutrální — topované inzeráty se obnovují každý den, skutečné stáří není známé.');
  else if (components.freshness >= 0.8)
    lines.push(isPolish ? 'Oferta została dodana niedawno.' : 'Inzerát byl přidán nedávno.');
  else if (components.freshness <= 0.2)
    lines.push(isPolish ? 'Oferta jest starsza niż dwa tygodnie.' : 'Inzerát je starší než dva týdny.');

  if (components.sellerTrust >= 0.75)
    lines.push(isPolish ? 'Sprzedający ma wysoką ocenę i dobre opinie.' : 'Prodávající má vysoké hodnocení a dobré recenze.');
  else if (listing.sellerRating === null && listing.sellerReviewCount === null)
    lines.push(isPolish ? 'Dla tego źródła nie ma danych o reputacji sprzedającego.' : 'Pro tento zdroj nejsou dostupná data o reputaci prodávajícího.');

  if (components.spamPenalty < 0) {
    if (listing.price !== null && listing.price < market.minPlausiblePrice)
      lines.push(isPolish ? 'Kara: cena jest nienaturalnie niska — możliwy placeholder albo oszustwo.' : 'Penalizace: cena je neuvěřitelně nízká — možný placeholder nebo podvod.');
    else
      lines.push(isPolish ? 'Kara: oferta wygląda jak spam albo wielokrotnie odświeżane ogłoszenie.' : 'Penalizace: inzerát odpovídá vzorům spamu nebo opakovaných vkladů.');
  }

  if (components.engagement >= 0.75)
    lines.push(isPolish ? 'Wysoka liczba wyświetleń względem wieku oferty.' : 'Vysoký počet zobrazení vzhledem ke stáří inzerátu.');
  else if (components.engagement <= 0.25 && listing.views !== null)
    lines.push(isPolish ? 'Niska liczba wyświetleń względem wieku oferty.' : 'Nízký počet zobrazení vzhledem ke stáří inzerátu.');

  if (listing.shippingAvailable === true)
    lines.push(isPolish ? 'Dostępna wysyłka.' : 'Možnost doručení.');

  return lines;
}

// ─── Source-aware weight redistribution ──────────────────────────────────────
//
// Several sources (Bazoš, Sbazar) structurally cannot provide seller ratings or
// engagement signals.  When those fields are null on every listing from a source
// the corresponding weight is just dead constant offset — it doesn't differentiate
// anything.  We redistribute those weights to components that DO have data:
//
//   sellerTrust unavailable → +60% to valueForMoney, +40% to relevance
//   engagement unavailable  → +100% to freshness  (recency proxies popularity)
//
// Redistribution only applies when BOTH sub-signals are null, which is the
// structural-unavailability case.  A single-source search benefits because the
// normalisation denominator (maxRaw) shrinks accordingly, keeping scores [0–1].

function getEffectiveWeights(
  listing: NormalizedListing,
  base: ScoringWeights,
): ScoringWeights {
  const w = { ...base };

  const hasSellerData =
    listing.sellerRating !== null || listing.sellerReviewCount !== null;

  const hasEngagementData =
    listing.views !== null || listing.likes !== null;

  if (!hasSellerData && w.sellerTrust > 0) {
    w.valueForMoney += w.sellerTrust * 0.6;
    w.relevance     += w.sellerTrust * 0.4;
    w.sellerTrust    = 0;
  }

  if (!hasEngagementData && w.engagement > 0) {
    w.freshness  += w.engagement;
    w.engagement  = 0;
  }

  return w;
}

// ─── Main scorer ─────────────────────────────────────────────────────────────

export function scoreListings(
  listings: NormalizedListing[],
  query: string,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  marketConfig: MarketConfig = czMarket,
): ScoredListing[] {
  // Pre-compute relevance so we can filter out accessories before calculating
  // the price median — cheap cases/chargers would otherwise drag the median down
  // and make actual phones look overpriced.
  const relevanceScores = listings.map((l) =>
    scoreRelevance(query, l.title, l.description, marketConfig),
  );

  const relevantPrices = listings
    .filter((l, i) => relevanceScores[i] > 0.3 && l.price !== null && l.price > 0)
    .map((l) => l.price as number);

  // Fall back to all prices if too few relevant listings found
  const validPrices =
    relevantPrices.length >= 3
      ? relevantPrices
      : listings.map((l) => l.price).filter((p): p is number => p !== null && p > 0);

  // Filter out listings with near-zero relevance — these are structurally
  // unrelated results (e.g. Fler returning fashion items for "Skoda Octavia").
  const RELEVANCE_GATE = 0.1;
  const filteredListings = listings.filter((_, i) => relevanceScores[i] >= RELEVANCE_GATE);
  const filteredRelevance = relevanceScores.filter((s) => s >= RELEVANCE_GATE);

  return filteredListings.map((listing, idx) => {
    // Adjust weights for signals this source structurally cannot provide
    const w = getEffectiveWeights(listing, weights);

    const relevance = filteredRelevance[idx];
    const valueForMoney = scoreValueForMoney(listing.price, validPrices);
    const condition     = scoreCondition(listing.condition);
    // Topped (promoted) listings are re-topped daily so postedAt always shows
    // today — the real listing age is unknown. Use neutral 0.5 instead.
    const freshness    = listing.promoted ? 0.5 : scoreFreshness(listing.postedAt);
    const completeness = scoreCompleteness(listing);
    const sellerTrust  = scoreSellerTrust(listing.sellerRating, listing.sellerReviewCount);
    const engagement   = scoreEngagement(listing.views, listing.likes, listing.postedAt);

    const promotedPenalty = listing.promoted ? w.promotedPenalty : 0;
    const spamPenalty = detectLowQuality(listing, marketConfig) ? w.spamPenalty : 0;

    const components: ScoreComponents = {
      relevance,
      valueForMoney,
      condition,
      freshness,
      completeness,
      sellerTrust,
      engagement,
      promotedPenalty,
      spamPenalty,
    };

    // Weighted sum of positive components using effective (redistributed) weights
    const raw =
      w.relevance * relevance +
      w.valueForMoney * valueForMoney +
      w.condition * condition +
      w.freshness * freshness +
      w.completeness * completeness +
      w.sellerTrust * sellerTrust +
      w.engagement * engagement;

    // Max possible raw score given effective weights
    const maxRaw =
      w.relevance +
      w.valueForMoney +
      w.condition +
      w.freshness +
      w.completeness +
      w.sellerTrust +
      w.engagement;

    // Normalise to 0–1, then apply additive penalties, clamp to [0, 1]
    const normalised = raw / maxRaw;
    const penalised = Math.max(0, normalised + promotedPenalty + spamPenalty);
    const score = Math.round(penalised * 100);

    return {
      ...listing,
      score,
      scoreComponents: components,
      scoreExplanation: buildExplanation(components, listing, weights, marketConfig),
    };
  });
}
