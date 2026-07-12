/**
 * Post-search finalization: detail-page enrichment for the top results,
 * price-history annotation, and (fire-and-forget) snapshot recording.
 * Everything inside is best-effort — a failure never breaks the search.
 */
import type { ScoredListing } from '@sdf/types';
import { enrichTopResults } from './enrich.js';
import { annotatePriceHistory, recordListingSnapshots } from './listing-snapshots.js';

export async function finalizeSearchResults(results: ScoredListing[]): Promise<ScoredListing[]> {
  await Promise.all([
    enrichTopResults(results),
    annotatePriceHistory(results),
  ]);

  // Record today's prices in the background — response must not wait on it.
  void recordListingSnapshots(results);

  return results;
}
