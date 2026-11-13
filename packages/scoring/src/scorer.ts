import type {
  MarketConfig,
  NormalizedListing,
  PriceCheck,
  ScoredListing,
  ScoringWeights,
  ScoreComponents,
} from '@sdf/types';
import { czMarket } from '@sdf/types';
import { DEFAULT_WEIGHTS } from './weights.js';
import { scoreRelevance } from './components/relevance.js';
import { analyzeQuery, createListingKindFilter } from './components/listing-kind.js';
import { buildPriceReference } from './components/value-for-money.js';
import { scoreCondition } from './components/condition.js';
import { scoreFreshness } from './components/freshness.js';
import { scoreCompleteness } from './components/completeness.js';
import { scoreSellerTrust } from './components/seller-trust.js';
import { scoreEngagement } from './components/engagement.js';

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
  priceCheck?: PriceCheck,
): string[] {
  const lines: string[] = [];
  const isPolish = market.id === 'pl';

  if (components.relevance >= 0.8)
    lines.push(isPolish ? 'Bardzo dobra zgodność z wyszukiwanym hasłem.' : 'Výborná shoda s hledaným výrazem.');
  else if (components.relevance < 0.4)
    lines.push(isPolish ? 'Częściowa zgodność — brakuje części słów kluczowych.' : 'Částečná shoda — některá klíčová slova chybí.');

  // Warnings about the price itself hold whatever the sort is
  if (priceCheck?.flag === 'placeholder') {
    lines.push(isPolish
      ? 'Cena wygląda na wpisaną dla formalności — prawdziwej szukaj w opisie.'
      : 'Cena vypadá jako zástupná — skutečnou hledejte v textu inzerátu.');
  } else if (priceCheck?.flag === 'suspiciously_low') {
    const pct = Math.round(priceCheck.ratio * 100);
    lines.push(isPolish
      ? `Uwaga: cena to tylko ${pct} % mediany ${priceCheck.sampleSize} porównywalnych ofert — sprawdź stan i sprzedającego.`
      : `Pozor: cena je jen ${pct} % mediánu ${priceCheck.sampleSize} srovnatelných nabídek — ověřte stav a prodejce.`);
  } else if (weights.valueForMoney === 0) {
    lines.push(isPolish ? 'Cena nie była uwzględniona w ocenie.' : 'Cena nebyla při hodnocení zohledněna.');
  } else if (priceCheck) {
    const diff = Math.round((priceCheck.ratio - 1) * 100);
    const group = comparisonGroupLabel(priceCheck, isPolish);
    if (diff <= -8) {
      lines.push(isPolish
        ? `Cena jest o ${-diff} % niższa niż mediana ${group}.`
        : `Cena je o ${-diff} % pod mediánem ${group}.`);
    } else if (diff >= 8) {
      lines.push(isPolish
        ? `Cena jest o ${diff} % wyższa niż mediana ${group}.`
        : `Cena je o ${diff} % nad mediánem ${group}.`);
    } else {
      lines.push(isPolish
        ? `Cena odpowiada medianie ${group}.`
        : `Cena odpovídá mediánu ${group}.`);
    }
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

/** "34 nabídek stejného modelu a paměti" — what the price was compared with. */
function comparisonGroupLabel(check: PriceCheck, isPolish: boolean): string {
  const n = check.sampleSize;
  if (isPolish) {
    switch (check.basis) {
      case 'same_spec': return `${n} ofert tego samego modelu i pamięci`;
      case 'same_model': return `${n} ofert tego samego modelu`;
      case 'model_family': return `${n} ofert z tej samej serii`;
      default: return `${n} podobnych ofert w tym wyszukiwaniu`;
    }
  }
  switch (check.basis) {
    case 'same_spec': return `${n} nabídek stejného modelu a paměti`;
    case 'same_model': return `${n} nabídek stejného modelu`;
    case 'model_family': return `${n} nabídek stejné modelové řady`;
    default: return `${n} podobných nabídek v tomto hledání`;
  }
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

/** Same cap scoreRelevance applies to "Kryt pro iPhone 13" — below RELEVANCE_GATE. */
const HIDDEN_KIND_RELEVANCE = 0.05;

/**
 * "iphone 13" also finds the 13 mini, Pro and Pro Max. They stay in the
 * results but rank after the model that was asked for.
 */
const OTHER_VARIANT_FACTOR = 0.92;

/**
 * The query pins a model and only the description — not the title — supplies
 * the match: "Galaxy S26 Ultra … Výměna za iPhone" whose text mentions an
 * iPhone 13, a MacBook ad that lists the seller's other devices. Such a
 * listing may still be the product ("Prodám iPhone" + "iPhone 13, 128 GB" in
 * the text), so it stays, behind the listings whose title names the model.
 */
const DESCRIPTION_ONLY_MODEL_FACTOR = 0.85;

/** What the buyer pays — the listed price plus any mandatory marketplace fee. */
const priceToPay = (l: NormalizedListing): number | null => l.totalPrice ?? l.price;

export function scoreListings(
  listings: NormalizedListing[],
  query: string,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  marketConfig: MarketConfig = czMarket,
): ScoredListing[] {
  // Pre-compute relevance so we can filter out accessories before calculating
  // the price median — cheap cases/chargers would otherwise drag the median down
  // and make actual phones look overpriced. Listings that are not the searched
  // product at all (parts, toy models, games, "na ND" — see listing-kind.ts)
  // get the same capped score as a title-matched accessory, so the relevance
  // gate below drops them.
  const kindOf = createListingKindFilter(query, listings, marketConfig);
  const queryWantsAccessories = analyzeQuery(query, marketConfig).wants.has('accessory');
  // A listing priced like the product is a bundle ("Garmin Venu 4 + řemínek"),
  // so the title-based accessory guard does not apply to it either.
  const matcher = kindOf.matcher;
  const signatures = listings.map((l) => matcher.signature(l.title));
  const relevanceScores = listings.map((l, i) => {
    if (kindOf(l)) return HIDDEN_KIND_RELEVANCE;
    const relevanceOpts = {
      queryWantsAccessories: queryWantsAccessories || kindOf.pricedLikeProduct(l),
    };
    const relevance = scoreRelevance(query, l.title, l.description, marketConfig, relevanceOpts);
    if (!matcher.pinned) return relevance;

    if (signatures[i].model === 'match') {
      const otherVariant = signatures[i].variants.some((v) => !matcher.queryVariants.includes(v));
      return otherVariant ? relevance * OTHER_VARIANT_FACTOR : relevance;
    }
    // Title does not name the model: did the description carry the match?
    if (!l.description) return relevance;
    const titleOnly = scoreRelevance(query, l.title, null, marketConfig, relevanceOpts);
    return titleOnly < relevance
      ? Math.max(titleOnly, relevance * DESCRIPTION_ONLY_MODEL_FACTOR)
      : relevance;
  });

  // Reference prices come from relevant listings only — cheap cases and
  // chargers would otherwise drag the median down — and are kept per model,
  // variant and storage (see value-for-money.ts).
  const priceReference = buildPriceReference(
    listings.map((l, i) => ({
      price: priceToPay(l),
      signature: signatures[i],
      comparable: relevanceScores[i] > 0.3,
    })),
  );

  // Filter out listings with near-zero relevance — these are structurally
  // unrelated results (e.g. Fler returning fashion items for "Skoda Octavia").
  const RELEVANCE_GATE = 0.1;
  const filteredListings = listings.filter((_, i) => relevanceScores[i] >= RELEVANCE_GATE);
  const filteredRelevance = relevanceScores.filter((s) => s >= RELEVANCE_GATE);
  const filteredSignatures = signatures.filter((_, i) => relevanceScores[i] >= RELEVANCE_GATE);

  return filteredListings.map((listing, idx) => {
    // Adjust weights for signals this source structurally cannot provide
    const w = getEffectiveWeights(listing, weights);

    const relevance = filteredRelevance[idx];
    const { score: valueForMoney, check: priceCheck } =
      priceReference.assess(priceToPay(listing), filteredSignatures[idx]);
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
      scoreExplanation: buildExplanation(components, listing, weights, marketConfig, priceCheck),
      ...(priceCheck ? { priceCheck } : {}),
    };
  });
}
