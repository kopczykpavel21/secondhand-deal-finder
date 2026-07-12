/**
 * Detail-page enrichment — fetches full descriptions / condition / views for
 * the TOP results only (one HTTP GET per listing, bounded, parallel).
 * Results are cached in-memory so repeat searches don't refetch.
 */
import type { ListingDetail, ScoredListing, Source, SourceAdapter } from '@sdf/types';
import { BazosAdapter } from '@sdf/source-adapters';

const ENRICH_LIMIT = Number(process.env.ENRICH_TOP_N ?? 8);
const ENRICH_TIMEOUT_MS = Number(process.env.ENRICH_TIMEOUT_MS ?? 3_500);
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 2_000;

// Dedicated lightweight adapter instances for detail fetches only (stateless
// HTTP GETs — separate from the search adapter pool on purpose).
const detailAdapters = new Map<Source, SourceAdapter>();

function getDetailAdapter(source: Source): SourceAdapter | null {
  const existing = detailAdapters.get(source);
  if (existing) return existing;

  let adapter: SourceAdapter | null = null;
  switch (source) {
    case 'bazos':
      adapter = new BazosAdapter({ retries: 0, timeout: ENRICH_TIMEOUT_MS });
      break;
    // Additional sources can be added here once they implement
    // fetchListingDetail (Sbazar JSON-LD, TipCars detail page…).
    default:
      return null;
  }
  detailAdapters.set(source, adapter);
  return adapter;
}

interface CacheEntry {
  detail: ListingDetail | null;
  expiresAt: number;
}

const detailCache = new Map<string, CacheEntry>();

function cacheGet(id: string): CacheEntry | undefined {
  const entry = detailCache.get(id);
  if (entry && entry.expiresAt < Date.now()) {
    detailCache.delete(id);
    return undefined;
  }
  return entry;
}

function cacheSet(id: string, detail: ListingDetail | null): void {
  if (detailCache.size >= CACHE_MAX) {
    // Drop the oldest entries (Map preserves insertion order)
    let dropped = 0;
    for (const key of detailCache.keys()) {
      detailCache.delete(key);
      if (++dropped >= CACHE_MAX / 4) break;
    }
  }
  detailCache.set(id, { detail, expiresAt: Date.now() + CACHE_TTL_MS });
}

function applyDetail(listing: ScoredListing, detail: ListingDetail): void {
  if (detail.description && (listing.description?.length ?? 0) < detail.description.length) {
    listing.description = detail.description;
  }
  if (detail.conditionText && listing.condition === 'unknown') {
    listing.conditionText = detail.conditionText;
    if (detail.condition) listing.condition = detail.condition;
  }
  if (detail.views !== null && detail.views !== undefined && listing.views === null) {
    listing.views = detail.views;
  }
  if (detail.sellerName && !listing.sellerName) {
    listing.sellerName = detail.sellerName;
  }
  listing.enriched = true;
}

/**
 * Enriches the first `limit` listings in-place (parallel, per-fetch timeout,
 * failures ignored). Returns the same array.
 */
export async function enrichTopResults(
  listings: ScoredListing[],
  limit: number = ENRICH_LIMIT,
): Promise<ScoredListing[]> {
  const targets = listings.slice(0, limit).filter((l) => !l.enriched);

  await Promise.allSettled(
    targets.map(async (listing) => {
      const cached = cacheGet(listing.id);
      if (cached !== undefined) {
        if (cached.detail) applyDetail(listing, cached.detail);
        return;
      }

      const adapter = getDetailAdapter(listing.source);
      if (!adapter?.fetchListingDetail) return;

      try {
        const detail = await Promise.race([
          adapter.fetchListingDetail(listing),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), ENRICH_TIMEOUT_MS)),
        ]);
        cacheSet(listing.id, detail);
        if (detail) applyDetail(listing, detail);
      } catch {
        // enrichment is best-effort — cache the miss to avoid hammering
        cacheSet(listing.id, null);
      }
    }),
  );

  return listings;
}
