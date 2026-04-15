import type {
  NormalizedListing,
  SearchFilters,
  SearchRequest,
  SearchResponse,
  SearchStreamEvent,
  ScoredListing,
  ScoringWeights,
  Source,
  SourceStatus,
  SortOption,
} from '@sdf/types';
import type { SourceAdapter } from '@sdf/types';
import { scoreListings, DEFAULT_WEIGHTS } from '@sdf/scoring';
import { deduplicateListings } from './deduplicator';

// ─── Minimal async queue — delivers items in arrival order ───────────────────

class DeferredQueue<T> {
  private buffer: T[] = [];
  private waiters: Array<(v: T) => void> = [];

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.buffer.push(value);
  }

  take(): Promise<T> {
    const buffered = this.buffer.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// Hard wall-clock limit per source adapter.  Playwright adapters (Sbazar,
// Vinted) can retry internally up to 2×, so keep this above 2 × 20 s = 40 s.
// HTTP adapters (Bazoš, Aukro) finish in < 5 s so the timeout never triggers.
const ADAPTER_TIMEOUT_MS = 55_000;

// ─── Result cache ─────────────────────────────────────────────────────────────
// Caches complete search responses for CACHE_TTL_MS to avoid re-scraping
// identical queries within the same server session.

const CACHE_TTL_MS = 20 * 60 * 1_000; // 20 minutes

interface CacheEntry {
  response: SearchResponse;
  expiresAt: number;
}

function cacheKey(request: SearchRequest): string {
  return JSON.stringify({
    q: request.query.toLowerCase().trim(),
    f: request.filters ?? {},
    l: Math.min(request.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
  });
}

export class SearchCoordinator {
  private adapters: Map<Source, SourceAdapter>;
  private cache = new Map<string, CacheEntry>();

  constructor(adapters: SourceAdapter[]) {
    this.adapters = new Map(adapters.map((a) => [a.source, a]));
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    // Serve from cache when debug is not requested
    if (!request.debug) {
      const key = cacheKey(request);
      const cached = this.cache.get(key);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.response;
      }
    }

    const start = Date.now();
    const { query, filters, debug } = request;
    const limit = Math.min(request.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Determine which sources to query
    const activeSources: Source[] = filters?.sources?.length
      ? filters.sources
      : (Array.from(this.adapters.keys()) as Source[]);

    // Fan out to all adapters concurrently with per-source timeout guard
    const adapterResults = await Promise.allSettled(
      activeSources
        .map((source) => this.adapters.get(source))
        .filter((adapter): adapter is SourceAdapter => adapter !== undefined)
        .map((adapter) => this.runAdapter(adapter, query, filters)),
    );

    const allListings: NormalizedListing[] = [];
    const sourceStatuses: SourceStatus[] = [];
    const adapterLogs: Partial<Record<Source, string[]>> = {};

    for (const result of adapterResults) {
      if (result.status === 'fulfilled') {
        const { status, listings, logs } = result.value;
        sourceStatuses.push(status);
        allListings.push(...listings);
        adapterLogs[status.source] = logs;
      } else {
        // The outer guard already catches errors — this shouldn't happen
        console.error('[coordinator] Unexpected rejection:', result.reason);
      }
    }

    // Deduplicate
    const { listings: deduped, groups: dedupeGroups } =
      deduplicateListings(allListings);

    // Score all listings (use relevance-heavy weights when requested)
    const weights = getWeightsForSort(filters?.sortBy);
    const scored = scoreListings(deduped, query, weights);

    // Post-scoring dedup: keep only the highest-scored listing per duplicate group
    const dedupeFiltered = removeScoredDuplicates(scored, dedupeGroups);

    // Sort according to user preference
    const sorted = sortResults(dedupeFiltered, filters?.sortBy ?? 'best_deal');

    // Take top N
    const topResults = sorted.slice(0, limit);

    const executionMs = Date.now() - start;

    const response: SearchResponse = {
      results: topResults,
      total: sorted.length,
      sources: sourceStatuses,
      query,
      executionMs,
    };

    if (debug) {
      response.debug = {
        rawListings: allListings,
        scoreBreakdowns: Object.fromEntries(
          scored.map((l) => [l.id, l.scoreComponents]),
        ),
        dedupeGroups,
        adapterLogs: adapterLogs as Record<Source, string[]>,
      };
    }

    // Store in cache (only non-debug responses)
    if (!debug) {
      this.cache.set(cacheKey(request), { response, expiresAt: Date.now() + CACHE_TTL_MS });
      // Evict expired entries to prevent unbounded growth
      for (const [k, v] of this.cache) {
        if (Date.now() >= v.expiresAt) this.cache.delete(k);
      }
    }

    return response;
  }

  /**
   * Streaming variant of `search()`.
   * Yields a `source_done` event each time an adapter finishes (with
   * re-scored partial results), then a final `complete` event.
   * Consumers can render progressive results without waiting for the
   * slowest source.
   */
  async *searchStream(request: SearchRequest): AsyncGenerator<SearchStreamEvent> {
    const start = Date.now();
    const { query, filters } = request;
    const limit = Math.min(request.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const weights = getWeightsForSort(filters?.sortBy);

    const activeSources: Source[] = filters?.sources?.length
      ? filters.sources
      : (Array.from(this.adapters.keys()) as Source[]);

    const activeAdapters = activeSources
      .map((s) => this.adapters.get(s))
      .filter((a): a is SourceAdapter => a !== undefined);

    const totalSources = activeAdapters.length;
    const queue = new DeferredQueue<Awaited<ReturnType<SearchCoordinator['runAdapter']>>>();

    // Kick off all adapters — each pushes into the queue on completion
    for (const adapter of activeAdapters) {
      this.runAdapter(adapter, query, filters).then((r) => queue.push(r));
    }

    const allListings: NormalizedListing[] = [];
    const allStatuses: SourceStatus[] = [];
    let completedSources = 0;

    while (completedSources < totalSources) {
      const { status, listings } = await queue.take();
      completedSources++;

      allListings.push(...listings);
      allStatuses.push(status);

      // Re-score everything accumulated so far
      const { listings: deduped, groups } = deduplicateListings(allListings);
      const scored = scoreListings(deduped, query, weights);
      const filtered = removeScoredDuplicates(scored, groups);
      const sorted = sortResults(filtered, filters?.sortBy ?? 'best_deal');

      yield {
        type: 'source_done',
        status,
        results: sorted.slice(0, limit),
        total: sorted.length,
        completedSources,
        totalSources,
      };
    }

    // Final event with complete metadata
    const { listings: deduped, groups } = deduplicateListings(allListings);
    const scored = scoreListings(deduped, query, weights);
    const filtered = removeScoredDuplicates(scored, groups);
    const sorted = sortResults(filtered, filters?.sortBy ?? 'best_deal');

    yield {
      type: 'complete',
      results: sorted.slice(0, limit),
      total: sorted.length,
      sources: allStatuses,
      executionMs: Date.now() - start,
    };
  }

  private async runAdapter(
    adapter: SourceAdapter,
    query: string,
    filters?: SearchFilters,
  ): Promise<{
    status: SourceStatus;
    listings: NormalizedListing[];
    logs: string[];
  }> {
    const t0 = Date.now();
    try {
      // Race the adapter against a hard wall-clock deadline so a hung
      // Playwright page (blocked IP, networkidle that never fires, OOM during
      // a retry) cannot hold up the entire search stream indefinitely.
      const listings = await Promise.race([
        adapter.searchListings(query, filters),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`source timed out after ${ADAPTER_TIMEOUT_MS / 1000}s`)),
            ADAPTER_TIMEOUT_MS,
          ),
        ),
      ]);
      const logs = (adapter as unknown as { flushLogs?: () => string[] }).flushLogs?.() ?? [];
      return {
        status: {
          source: adapter.source,
          supportLevel: adapter.supportLevel,
          success: true,
          listingsFound: listings.length,
          executionMs: Date.now() - t0,
        },
        listings,
        logs,
      };
    } catch (err) {
      const logs = (adapter as unknown as { flushLogs?: () => string[] }).flushLogs?.() ?? [];
      console.error(`[coordinator] Adapter ${adapter.source} failed:`, err);
      return {
        status: {
          source: adapter.source,
          supportLevel: adapter.supportLevel,
          success: false,
          listingsFound: 0,
          error: (err as Error).message,
          executionMs: Date.now() - t0,
        },
        listings: [],
        logs,
      };
    }
  }
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
function getWeightsForSort(sortBy?: SortOption): ScoringWeights {
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
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return a.price - b.price;
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
