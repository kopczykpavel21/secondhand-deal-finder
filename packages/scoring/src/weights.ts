import type { ScoringWeights } from '@sdf/types';

export const DEFAULT_WEIGHTS: ScoringWeights = {
  relevance: 0.50,
  valueForMoney: 0.25,
  condition: 0.15,
  freshness: 0.10,
  completeness: 0.10,
  sellerTrust: 0.10,     // Aukro exposes seller feedback % — redistributed to valueForMoney+relevance for sources that don't
  engagement: 0.15,     // Views velocity (age-normalised) — meaningful signal on Bazoš and future sources
  promotedPenalty: 0,      // Topování (paid promotion) is not penalised — scored on merit only
  spamPenalty: -0.40,
};

// Weights must sum to ≤ 1.0 for positive components.
// Penalties are applied additively as multipliers on the final score.
export function validateWeights(w: ScoringWeights): void {
  const positiveSum =
    w.relevance +
    w.valueForMoney +
    w.condition +
    w.freshness +
    w.completeness +
    w.sellerTrust +
    w.engagement;

  if (positiveSum > 1.5) {
    console.warn(
      `[scoring] Positive weights sum to ${positiveSum.toFixed(2)} — consider normalising.`,
    );
  }
}
