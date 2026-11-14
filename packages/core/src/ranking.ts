/**
 * The ranking pipeline as one pure function: dedupe → score → drop irrelevant
 * → keep the best of each duplicate group → sort.
 *
 * Lives outside SearchCoordinator so it can be replayed over frozen search
 * results (see __fixtures__/ranking and ranking.test.ts) — a ranking change is
 * then measured against real listings instead of judged by eye.
 */
import type {
  MarketConfig,
  NormalizedListing,
  ScoredListing,
  ScoringWeights,
  SearchFilters,
  SortOption,
} from '@sdf/types';
import { czMarket } from '@sdf/types';
import { scoreListings, DEFAULT_WEIGHTS } from '@sdf/scoring';
import { deduplicateListings } from './deduplicator.js';

// Listings scoring below this relevance are dropped entirely. The accessory
// guard caps spare-part/accessory listings at 0.05 ("Kryt pro iPhone 13",
// "Nárazník Škoda Octavia"), and completely unrelated listings score 0 —
// without a floor both still appear in results and dominate the "cheapest"
// sort. A one-of-three token match scores ≥ 0.33, so genuine results pass.
const MIN_RELEVANCE = 0.1;

function dropIrrelevant(listings: ScoredListing[]): ScoredListing[] {
  return listings.filter((l) => l.scoreComponents.relevance >= MIN_RELEVANCE);
}

export interface RankedListings {
  /** Every surviving listing, in the requested order. */
  results: ScoredListing[];
  /** Everything that was scored, before duplicate removal — for debug output. */
  scored: ScoredListing[];
  dedupeGroups: Record<string, string[]>;
}

export function rankListings(
  listings: NormalizedListing[],
  query: string,
  filters?: Pick<SearchFilters, 'sortBy'>,
  marketConfig: MarketConfig = czMarket,
): RankedListings {
  const { listings: deduped, groups: dedupeGroups } =
    deduplicateListings(listings, marketConfig.priceBucketSize);

  // Score all listings (use relevance-heavy weights when requested)
  const weights = getWeightsForSort(filters?.sortBy);
  const scored = dropIrrelevant(scoreListings(deduped, query, weights, marketConfig));

  // Post-scoring dedup: keep only the highest-scored listing per duplicate group
  const dedupeFiltered = removeScoredDuplicates(scored, dedupeGroups);

  return {
    results: sortResults(dedupeFiltered, filters?.sortBy ?? 'best_deal'),
    scored,
    dedupeGroups,
  };
}

/**
 * After scoring, remove lower-ranked duplicates from the same dedupeGroup.
 * The pre-scoring deduplicator marks groups but intentionally keeps all members
 * so scoring can run over all of them. This pass then keeps only the winner.
 */
function removeScoredDuplicates(
  listings: ScoredListing[],
  groups: Record<string, string[]>,
): ScoredListing[] {
  if (Object.keys(groups).length === 0) return listings;

  // Build a set of ALL ids that are part of some dedupe group
  const allGroupedIds = new Set(Object.values(groups).flat());

  // For each group, find the listing with the highest score
  const bestPerGroup = new Map<string, string>(); // groupId → winning listing id
  for (const [groupId, ids] of Object.entries(groups)) {
    let bestId = ids[0];
    let bestScore = -1;
    for (const id of ids) {
      const l = listings.find((x) => x.id === id);
      if (l && l.score > bestScore) {
        bestScore = l.score;
        bestId = id;
      }
    }
    bestPerGroup.set(groupId, bestId);
  }

  return listings.filter((l) => {
    // Not in any group → always keep
    if (!allGroupedIds.has(l.id)) return true;
    // In a group → keep only if this is the winner
    const groupId = l.dedupeGroup;
    if (!groupId) return true;
    return bestPerGroup.get(groupId) === l.id;
  });
}

/**
 * Returns scoring weights tuned for the requested sort mode.
 * 'most_relevant': price ignored entirely, relevance dominates.
 */
export function getWeightsForSort(sortBy?: SortOption): ScoringWeights {
  if (sortBy === 'most_relevant') {
    return {
      ...DEFAULT_WEIGHTS,
      relevance: 0.80,      // strong relevance signal
      valueForMoney: 0,     // price completely ignored
      condition: 0.10,
      freshness: 0.08,
      completeness: 0.06,
      sellerTrust: 0.06,
      engagement: 0.04,
    };
  }
  return DEFAULT_WEIGHTS;
}

function sortResults(listings: ScoredListing[], sortBy: SortOption): ScoredListing[] {
  switch (sortBy) {
    case 'newest':
      return [...listings].sort((a, b) => {
        const ta = a.postedAt?.getTime() ?? 0;
        const tb = b.postedAt?.getTime() ?? 0;
        return tb - ta;
      });
    case 'cheapest':
      return [...listings].sort((a, b) => {
        // null/zero price = "price in description / on request" — sort last,
        // those listings are not actually free.
        const pa = a.price !== null && a.price > 0 ? a.price : Infinity;
        const pb = b.price !== null && b.price > 0 ? b.price : Infinity;
        return pa - pb;
      });
    case 'priciest':
      return [...listings].sort((a, b) => {
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return b.price - a.price;
      });
    case 'safest':
      return [...listings].sort(
        (a, b) => b.scoreComponents.sellerTrust - a.scoreComponents.sellerTrust,
      );
    case 'most_relevant':
    case 'best_deal':
    default:
      return [...listings].sort((a, b) => b.score - a.score);
  }
}
