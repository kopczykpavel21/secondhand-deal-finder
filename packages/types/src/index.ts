// Shared types for the Secondhand Deal Finder

export type Source = 'bazos' | 'sbazar' | 'vinted' | 'facebook' | 'aukro' | 'mock';
export type SourceSupportLevel = 'full' | 'partial' | 'experimental' | 'unavailable';
export type SortOption = 'best_deal' | 'newest' | 'cheapest' | 'safest' | 'most_relevant';
export type Condition = 'new' | 'like_new' | 'good' | 'fair' | 'poor' | 'unknown';

// ─── Core listing model ───────────────────────────────────────────────────────

export interface NormalizedListing {
  /** Stable identifier: `${source}:${sourceListingId}` */
  id: string;
  source: Source;
  sourceListingId: string;
  url: string;
  title: string;
  description: string | null;
  price: number | null;
  currency: string;
  location: string | null;
  postedAt: Date | null;
  conditionText: string | null;
  /** Normalized condition enum inferred from conditionText */
  condition: Condition;
  imageCount: number;
  imageUrl: string | null;
  sellerName: string | null;
  sellerRating: number | null;
  sellerReviewCount: number | null;
  views: number | null;
  likes: number | null;
  shippingAvailable: boolean | null;
  /** True when the adapter detects paid promotion signals */
  promoted: boolean;
  rawMetadata: Record<string, unknown>;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export interface ScoreComponents {
  /** 0–1: how well the listing matches the query */
  relevance: number;
  /** 0–1: price vs. median of same search */
  valueForMoney: number;
  /** 0–1: inferred condition quality */
  condition: number;
  /** 0–1: recency of the listing */
  freshness: number;
  /** 0–1: how many fields are populated */
  completeness: number;
  /** 0–1: seller reputation signals */
  sellerTrust: number;
  /** 0–1: engagement signals (views, likes…) */
  engagement: number;
  /** negative: penalty when promoted/boosted */
  promotedPenalty: number;
  /** negative: penalty for suspected spam/repost */
  spamPenalty: number;
}

export interface ScoredListing extends NormalizedListing {
  /** Final weighted score 0–100 */
  score: number;
  scoreComponents: ScoreComponents;
  /** Human-readable sentences explaining why this ranked where it did */
  scoreExplanation: string[];
  /** ID of deduplicated group when same item appears on multiple sources */
  dedupeGroup?: string;
}

// ─── Scoring weights (all configurable) ──────────────────────────────────────

export interface ScoringWeights {
  relevance: number;
  valueForMoney: number;
  condition: number;
  freshness: number;
  completeness: number;
  sellerTrust: number;
  engagement: number;
  promotedPenalty: number;
  spamPenalty: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  relevance: 0.50,
  valueForMoney: 0.25,
  condition: 0.15,
  freshness: 0.10,
  completeness: 0.10,
  sellerTrust: 0.10,
  engagement: 0.05,
  promotedPenalty: -0.15,
  spamPenalty: -0.20,
};

// ─── Search API ───────────────────────────────────────────────────────────────

export interface SearchFilters {
  priceMin?: number;
  priceMax?: number;
  location?: string;
  locationRadius?: number;
  sources?: Source[];
  sortBy?: SortOption;
}

export interface SearchRequest {
  query: string;
  filters?: SearchFilters;
  debug?: boolean;
  /** Max results to return. Default 25, max 50. */
  limit?: number;
}

export interface SourceStatus {
  source: Source;
  supportLevel: SourceSupportLevel;
  success: boolean;
  listingsFound: number;
  error?: string;
  executionMs: number;
}

export interface DebugInfo {
  rawListings: NormalizedListing[];
  scoreBreakdowns: Record<string, ScoreComponents>;
  dedupeGroups: Record<string, string[]>;
  adapterLogs: Record<Source, string[]>;
}

export interface SearchResponse {
  results: ScoredListing[];
  total: number;
  sources: SourceStatus[];
  query: string;
  executionMs: number;
  debug?: DebugInfo;
}

// ─── Streaming search events ──────────────────────────────────────────────────

export type SearchStreamEvent =
  /** One source finished — partial results re-scored with what we have so far */
  | {
      type: 'source_done';
      status: SourceStatus;
      results: ScoredListing[];
      total: number;
      completedSources: number;
      totalSources: number;
    }
  /** All sources finished — final authoritative results */
  | {
      type: 'complete';
      results: ScoredListing[];
      total: number;
      sources: SourceStatus[];
      executionMs: number;
    };

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface AdapterConfig {
  timeout: number;
  retries: number;
  rateLimitMs: number;
  userAgent: string;
  headless: boolean;
}

export const DEFAULT_ADAPTER_CONFIG: AdapterConfig = {
  timeout: 15_000,
  retries: 2,
  rateLimitMs: 1_500,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  headless: true,
};

export interface SourceAdapter {
  source: Source;
  supportLevel: SourceSupportLevel;
  config: AdapterConfig;
  searchListings(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]>;
  detectPromoted(raw: Record<string, unknown>): boolean;
  extractSellerSignals(
    raw: Record<string, unknown>,
  ): Pick<
    NormalizedListing,
    'sellerName' | 'sellerRating' | 'sellerReviewCount'
  >;
}
