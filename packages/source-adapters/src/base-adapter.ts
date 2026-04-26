import type {
  AdapterConfig,
  MarketConfig,
  NormalizedListing,
  SearchFilters,
  Source,
  SourceAdapter,
  SourceSupportLevel,
} from '@sdf/types';
import { DEFAULT_ADAPTER_CONFIG, czMarket, parseRelativeDate as parseMarketRelativeDate } from '@sdf/types';
import type { Page } from 'playwright';
import { withPooledPage } from './browser-pool';
import { normalizeCondition } from '@sdf/scoring';

export abstract class BaseAdapter implements SourceAdapter {
  abstract source: Source;
  abstract supportLevel: SourceSupportLevel;

  config: AdapterConfig;
  protected marketConfig: MarketConfig;
  protected logs: string[] = [];

  constructor(
    config: Partial<AdapterConfig> = {},
    marketConfig: MarketConfig = czMarket,
  ) {
    this.config = { ...DEFAULT_ADAPTER_CONFIG, ...config };
    this.marketConfig = marketConfig;
  }

  abstract searchListings(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]>;

  abstract detectPromoted(raw: Record<string, unknown>): boolean;

  abstract extractSellerSignals(
    raw: Record<string, unknown>,
  ): Pick<NormalizedListing, 'sellerName' | 'sellerRating' | 'sellerReviewCount'>;

  // ─── Browser helpers ──────────────────────────────────────────────────────

  /** Acquire a pooled browser context, run fn, then release back to the pool. */
  protected async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    return withPooledPage(fn);
  }

  async close(): Promise<void> {
    // No-op: lifecycle is managed by the global browser pool
  }

  // ─── Retry wrapper ────────────────────────────────────────────────────────

  protected async withRetry<T>(
    fn: () => Promise<T>,
    label: string,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        this.log(`[${label}] attempt ${attempt + 1} failed: ${(err as Error).message}`);
        if (attempt < this.config.retries) {
          await sleep(this.config.rateLimitMs * (attempt + 1));
        }
      }
    }
    throw lastError;
  }

  // ─── Shared normalisation helpers ─────────────────────────────────────────

  protected makeId(listingId: string): string {
    return `${this.source}:${listingId}`;
  }

  protected safePrice(raw: string | number | null | undefined): number | null {
    if (raw === null || raw === undefined) return null;
    const cleaned = String(raw).replace(/[^\d,.]/g, '').replace(',', '.');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) || parsed <= 0 ? null : parsed;
  }

  protected safeDate(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  protected parseRelativeDate(text: string | null | undefined): Date | null {
    const parsed = parseMarketRelativeDate(text, this.marketConfig);
    return parsed ?? this.safeDate(text);
  }

  /** Backward-compatible alias used by older Czech adapters. */
  protected parseCzechRelativeDate(text: string | null | undefined): Date | null {
    return this.parseRelativeDate(text);
  }

  protected inferCondition(conditionText: string | null): NormalizedListing['condition'] {
    return normalizeCondition(conditionText, this.marketConfig);
  }

  protected log(msg: string): void {
    this.logs.push(msg);
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[adapter:${this.source}] ${msg}`);
    }
  }

  public flushLogs(): string[] {
    const out = [...this.logs];
    this.logs = [];
    return out;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
