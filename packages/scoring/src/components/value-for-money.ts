/**
 * Value-for-money score: is the price attractive relative to comparable
 * listings in the same search?
 *
 * "Comparable" is the point. One median over a whole "iphone 13" search mixes
 * the mini, the base model, the Pro and the Pro Max; against it every mini
 * looks like a bargain and every Pro Max looks overpriced. So each listing is
 * compared with the narrowest group that has enough members:
 *
 *   same_spec     same model, same variant, same storage   (13 Pro 256 GB)
 *   same_model    same model, same variant                 (13 Pro)
 *   model_family  same model, any variant                  (13 *)
 *   search        every relevant listing — the old behaviour, and the only
 *                 level there is for a query without a model ("gauč")
 *
 * Two prices are not rewarded for being low:
 *
 *   placeholder        1, 111, 1 234 … typed to fill the field, when it is
 *                      also far below the group. Treated like a missing price.
 *   suspiciously_low   far below the group *and* far outside its spread.
 *                      Shown, flagged, and scored no higher than a listing
 *                      at the median — a working iPhone 13 for a third of
 *                      the going rate is a blocked phone, a scam or a typo
 *                      more often than a bargain.
 *
 * The spread test (robust z-score on log prices) is what keeps this from
 * firing on searches that are simply wide: "horské kolo" runs from 500 Kč
 * children's bikes to 60 000 Kč e-bikes, and a cheap one there is just cheap.
 */
import type { PriceBasis, PriceCheck } from '@sdf/types';
import { isPatternPrice, type ProductSignature } from './product-signature.js';

/** A group smaller than this says too little; fall back to the next level. */
const MIN_GROUP = 5;
/** Flagging a price as suspicious needs a firmer reference than scoring it. */
const MIN_GROUP_FOR_FLAG = 8;
/** Floor for the spread (σ of log price) so a tight group does not flag −15 %. */
const MIN_SPREAD = 0.12;

/** Like-for-like groups: under 60 % of the median and 2 σ below it. */
const SUSPICIOUS_LIKE_FOR_LIKE = { ratio: 0.6, z: -2 };
/** Whole-search group: only the extreme tail — the group is mixed by nature. */
const SUSPICIOUS_SEARCH = { ratio: 0.35, z: -3 };
const PLACEHOLDER_RATIO = 0.5;

/** No price, or a placeholder: cannot be evaluated. */
const SCORE_UNKNOWN_PRICE = 0.3;
/**
 * A flagged price scores at most what a listing at the median scores (0.5) —
 * the low price earns nothing — and less the further below it is: just under
 * the limit ≈ 0.5, at half the limit 0.25. Graded rather than flat because the
 * reference can be skewed (a dealer with twenty identical listings lifts the
 * median, and a fair private price then reads as "far below"): the borderline
 * case stays mid-list, only the extreme one sinks.
 */
const SCORE_SUSPICIOUS_MAX = 0.5;
const SCORE_SUSPICIOUS_MIN = 0.25;

interface PriceGroup {
  basis: PriceBasis;
  median: number;
  /** Robust σ of ln(price): 1.4826 × MAD, floored at MIN_SPREAD */
  spread: number;
  n: number;
}

export interface PricedListing {
  /** What the buyer pays: totalPrice when the source reports one, else price */
  price: number | null;
  signature: ProductSignature;
  /** Counts towards reference prices: relevant, not an accessory or a part */
  comparable: boolean;
}

export interface PriceAssessment {
  score: number;
  check?: PriceCheck;
}

export interface PriceReference {
  assess(price: number | null, signature: ProductSignature): PriceAssessment;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(prices: number[], basis: PriceBasis): PriceGroup {
  const sorted = [...prices].sort((a, b) => a - b);
  const med = median(sorted);
  const deviations = sorted.map((p) => Math.abs(Math.log(p / med))).sort((a, b) => a - b);
  return {
    basis,
    median: med,
    spread: Math.max(MIN_SPREAD, 1.4826 * median(deviations)),
    n: sorted.length,
  };
}

function groupKeys(sig: ProductSignature): Array<[PriceBasis, string]> {
  if (!sig.modelKey) return [];
  const variants = sig.variants.join('+') || 'base';
  const keys: Array<[PriceBasis, string]> = [];
  if (sig.storageGb != null) keys.push(['same_spec', `${sig.modelKey}|${variants}|${sig.storageGb}`]);
  keys.push(['same_model', `${sig.modelKey}|${variants}`]);
  keys.push(['model_family', sig.modelKey]);
  return keys;
}

/** ratio 0.5 → 0.85 · 0.8 → 0.64 · 1.0 → 0.50 · 1.5 → 0.27 · 2.0 → 0.15 */
function curve(ratio: number): number {
  return Math.min(1, Math.max(0, 1 / (1 + Math.pow(ratio, 2.5))));
}

export function buildPriceReference(listings: PricedListing[]): PriceReference {
  const usable = (l: PricedListing) => l.price !== null && l.price > 0 && !isPatternPrice(l.price);

  // Too few relevant listings → every priced listing, as before.
  let pool = listings.filter((l) => l.comparable && usable(l));
  if (pool.length < 3) pool = listings.filter(usable);

  const buckets = new Map<string, { basis: PriceBasis; prices: number[] }>();
  for (const l of pool) {
    for (const [basis, key] of groupKeys(l.signature)) {
      const bucket = buckets.get(key) ?? { basis, prices: [] };
      bucket.prices.push(l.price as number);
      buckets.set(key, bucket);
    }
  }
  const groups = new Map<string, PriceGroup>();
  for (const [key, { basis, prices }] of buckets) {
    if (prices.length >= MIN_GROUP) groups.set(key, summarize(prices, basis));
  }
  const whole = pool.length > 0 ? summarize(pool.map((l) => l.price as number), 'search') : null;

  const groupFor = (sig: ProductSignature): PriceGroup | null => {
    for (const [, key] of groupKeys(sig)) {
      const group = groups.get(key);
      if (group) return group;
    }
    return whole;
  };

  return {
    assess(price, signature) {
      if (price === null || price <= 0) return { score: SCORE_UNKNOWN_PRICE };
      const group = groupFor(signature);
      if (!group || group.median === 0) return { score: 0.5 };

      const ratio = price / group.median;
      const check: PriceCheck = {
        referencePrice: Math.round(group.median),
        sampleSize: group.n,
        basis: group.basis,
        ratio: Math.round(ratio * 100) / 100,
      };

      if (isPatternPrice(price) && ratio < PLACEHOLDER_RATIO) {
        return { score: SCORE_UNKNOWN_PRICE, check: { ...check, flag: 'placeholder' } };
      }

      const limit = group.basis === 'search' ? SUSPICIOUS_SEARCH : SUSPICIOUS_LIKE_FOR_LIKE;
      const z = Math.log(ratio) / group.spread;
      if (group.n >= MIN_GROUP_FOR_FLAG && ratio < limit.ratio && z < limit.z) {
        const score = Math.max(SCORE_SUSPICIOUS_MIN, SCORE_SUSPICIOUS_MAX * (ratio / limit.ratio));
        return { score, check: { ...check, flag: 'suspiciously_low' } };
      }

      return { score: curve(ratio), check };
    },
  };
}

/**
 * Price against the median of a plain list of prices — the pre-grouping
 * behaviour, kept for callers that have no signatures. Items with null price
 * get 0.3 (cannot be evaluated).
 */
export function scoreValueForMoney(
  price: number | null,
  allPrices: number[],
): number {
  if (price === null) return SCORE_UNKNOWN_PRICE;

  const validPrices = allPrices.filter((p) => p > 0);
  if (validPrices.length === 0) return 0.5;

  const med = median([...validPrices].sort((a, b) => a - b));
  if (med === 0) return 0.5;

  return curve(price / med);
}
