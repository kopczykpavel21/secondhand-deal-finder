import type {
  MarketConfig,
  NormalizedListing,
  SearchFilters,
  SearchRequest,
  SearchResponse,
  SearchStreamEvent,
  Source,
  SourceStatus,
} from '@sdf/types';
import { czMarket } from '@sdf/types';
import type { SourceAdapter } from '@sdf/types';
import { rankListings } from './ranking.js';
import {
  createSearchCacheKey,
  DEFAULT_SEARCH_CACHE_TTL_MS,
  type SearchCache,
} from './search-cache.js';

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

export interface SearchCoordinatorOptions {
  marketConfig?: MarketConfig;
  cache?: SearchCache | null;
  cacheNamespace?: string;
}

function isMarketConfigLike(value: SearchCoordinatorOptions | MarketConfig): value is MarketConfig {
  return typeof (value as MarketConfig)?.id === 'string';
}

export class SearchCoordinator {
  private adapters: Map<Source, SourceAdapter>;
  private marketConfig: MarketConfig;
  private cache: SearchCache | null;
  private cacheNamespace: string;

  constructor(
    adapters: SourceAdapter[],
    config: SearchCoordinatorOptions | MarketConfig = czMarket,
  ) {
    const options = isMarketConfigLike(config)
      ? { marketConfig: config, cache: null }
      : config;
    this.adapters = new Map(adapters.map((a) => [a.source, a]));
    this.marketConfig = options.marketConfig ?? czMarket;
    this.cache = options.cache ?? null;
    this.cacheNamespace = options.cacheNamespace ?? this.marketConfig.id;
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    // Serve from cache when debug is not requested
    const key = createSearchCacheKey(request, DEFAULT_LIMIT, MAX_LIMIT, this.cacheNamespace);
    if (!request.debug && this.cache) {
      const cached = await this.cache.get(key);
      if (cached) return cached;
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

    // Dedupe, score, drop irrelevant, sort according to user preference
    const { results: sorted, scored, dedupeGroups } =
      rankListings(allListings, query, filters, this.marketConfig);

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
    if (!debug && this.cache) {
      await this.cache.set(key, response, DEFAULT_SEARCH_CACHE_TTL_MS);
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
    const key = createSearchCacheKey(request, DEFAULT_LIMIT, MAX_LIMIT, this.cacheNamespace);
    if (!request.debug && this.cache) {
      const cached = await this.cache.get(key);
      if (cached) {
        yield {
          type: 'complete',
          results: cached.results,
          total: cached.total,
          sources: cached.sources,
          executionMs: cached.executionMs,
        };
        return;
      }
    }

    const start = Date.now();
    const { query, filters } = request;
    const limit = Math.min(request.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
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
      const { results: sorted } = rankListings(allListings, query, filters, this.marketConfig);

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
    const { results: sorted } = rankListings(allListings, query, filters, this.marketConfig);

    const finalEvent: SearchStreamEvent = {
      type: 'complete',
      results: sorted.slice(0, limit),
      total: sorted.length,
      sources: allStatuses,
      executionMs: Date.now() - start,
    };
    yield finalEvent;

    if (!request.debug && this.cache) {
      await this.cache.set(key, {
        results: finalEvent.results,
        total: finalEvent.total,
        sources: finalEvent.sources,
        query,
        executionMs: finalEvent.executionMs,
      }, DEFAULT_SEARCH_CACHE_TTL_MS);
    }
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
