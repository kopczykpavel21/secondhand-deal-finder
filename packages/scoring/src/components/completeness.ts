import type { NormalizedListing } from '@sdf/types';

// Weighted field importance
const FIELD_WEIGHTS: Array<[keyof NormalizedListing, number]> = [
  ['price', 2.0],
  ['title', 1.5],
  ['imageUrl', 1.5],
  ['description', 1.0],
  ['location', 1.0],
  ['postedAt', 0.8],
  ['conditionText', 0.8],
  ['sellerName', 0.5],
  ['shippingAvailable', 0.4],
  ['imageCount', 0.3],
];

const MAX_WEIGHT = FIELD_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

export function scoreCompleteness(listing: NormalizedListing): number {
  let earned = 0;
  for (const [field, weight] of FIELD_WEIGHTS) {
    const val = listing[field];
    const present =
      val !== null &&
      val !== undefined &&
      val !== '' &&
      !(typeof val === 'number' && isNaN(val));
    if (present) earned += weight;
  }
  return earned / MAX_WEIGHT;
}
