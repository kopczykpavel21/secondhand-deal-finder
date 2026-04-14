/**
 * Value-for-money score: is the price attractive relative to similar results?
 *
 * Strategy:
 *  1. Collect all prices from the same search batch.
 *  2. Compute the median (more robust than mean vs. outliers).
 *  3. Score = sigmoid-like curve centred at median.
 *
 * Items with null price get a neutral score of 0.3 (can't evaluate).
 */

export function scoreValueForMoney(
  price: number | null,
  allPrices: number[],
): number {
  if (price === null) return 0.3;

  const validPrices = allPrices.filter((p) => p > 0);
  if (validPrices.length === 0) return 0.5;

  const median = computeMedian(validPrices);
  if (median === 0) return 0.5;

  // ratio < 1 means cheaper than median → good value
  const ratio = price / median;

  // Smooth mapping:
  //   ratio 0.0 → 1.0
  //   ratio 0.5 → ~0.87
  //   ratio 1.0 → 0.50
  //   ratio 1.5 → ~0.25
  //   ratio 2.0 → 0.10
  const score = 1 / (1 + Math.pow(ratio, 2.5));

  return Math.min(1, Math.max(0, score));
}

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
