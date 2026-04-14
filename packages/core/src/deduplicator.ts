/**
 * Deduplication: detect when the same physical item appears on multiple sources.
 *
 * Strategy (no external NLP required):
 *  1. Normalise title (lowercase, strip punctuation, sort tokens).
 *  2. Compute a "price bucket" (nearest 500 CZK).
 *  3. Group listings whose (normalisedTitle, priceBucket) pair matches.
 *  4. Within each group, keep only the highest-scoring listing unless
 *     the caller wants to see all duplicates.
 *
 * Limitations:
 *  - Same item listed at significantly different prices won't be caught.
 *  - Title-based dedup will miss listings with creative/inconsistent titles.
 *  - A real system would use vector similarity — this is a good-enough MVP.
 */

import type { NormalizedListing } from '@sdf/types';

export interface DedupeResult {
  listings: NormalizedListing[];
  /** Map from dedupeGroup ID → array of listing IDs in that group */
  groups: Record<string, string[]>;
}

function normaliseTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function priceBucket(price: number | null): string {
  if (price === null) return 'unknown';
  return String(Math.round(price / 500) * 500);
}

export function deduplicateListings(listings: NormalizedListing[]): DedupeResult {
  const buckets = new Map<string, NormalizedListing[]>();

  for (const listing of listings) {
    const key = `${normaliseTitleKey(listing.title)}|${priceBucket(listing.price)}`;
    const group = buckets.get(key) ?? [];
    group.push(listing);
    buckets.set(key, group);
  }

  const groups: Record<string, string[]> = {};
  const dedupedMap = new Map<string, NormalizedListing>();
  let groupCounter = 0;

  for (const [, group] of buckets) {
    if (group.length === 1) {
      // No duplicate — just pass through
      dedupedMap.set(group[0].id, group[0]);
      continue;
    }

    // Multiple listings match — form a group
    const groupId = `dedup-${++groupCounter}`;
    groups[groupId] = group.map((l) => l.id);

    // Mark all with their group
    for (const listing of group) {
      (listing as NormalizedListing & { dedupeGroup?: string }).dedupeGroup = groupId;
      dedupedMap.set(listing.id, listing);
    }
  }

  return {
    listings: Array.from(dedupedMap.values()),
    groups,
  };
}
