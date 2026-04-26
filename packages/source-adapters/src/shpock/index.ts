/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — Shpock (shpock.com)
 *  Strategy: GraphQL POST to /graphql  (NO Playwright)
 *  Verified live: April 2026
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  How it works:
 *    1. POST https://www.shpock.com/graphql
 *    2. Query: itemSearch(trackingSource: Search, pagination: {...},
 *              serializedFilters: JSON.stringify({q, price?}))
 *    3. Response: itemResults[].items[] → ItemSummary fragments
 *
 *  GraphQL schema (relevant subset):
 *    itemSearch(
 *      trackingSource: TrackingSource!   // enum value: Search
 *      pagination: { limit: Int, offset: Int }
 *      serializedFilters: String         // JSON: { q, price: {from, to} }
 *    ): FetchItemsResponse
 *
 *    FetchItemsResponse {
 *      total: Int
 *      itemResults: [FetchItemsResult!]
 *      od: String    // opaque pagination cursor (unused)
 *    }
 *
 *    FetchItemsResult { items: [Summary!] }
 *
 *    ItemSummary (inline fragment on Summary) {
 *      id, title, price, currency, description, locality,
 *      path, isBoosted, isShippable, canonicalURL,
 *      media: [{ id, width, height }]
 *    }
 *
 *  Image URL:  https://m1.secondhandapp.at/2.0/{media[0].id}
 *  Listing URL: https://www.shpock.com/de-at/i/{id}/{slug}
 *               (replace locale prefix in path with de-at)
 *
 *  Extractable signals:
 *    ✅  Title, description, price (EUR), location (ZIP + city)
 *    ✅  Image URL
 *    ✅  Shipping available
 *    ✅  Promoted flag (isBoosted)
 *    ✅  Image count
 *    ❌  Posted date — not returned in search results
 *    ❌  Condition — not in ItemSummary
 *    ❌  Seller rating / review count
 *    ❌  Views / likes
 *
 *  Support level: FULL
 *  Primary market: Austria (de-at locale)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const GRAPHQL_URL = 'https://www.shpock.com/graphql';
const IMAGE_BASE = 'https://m1.secondhandapp.at/2.0';
const LISTING_LOCALE = 'de-at';
const PAGE_SIZE = 30;
const MAX_PAGES = 3;

// ─── GraphQL response types ───────────────────────────────────────────────────

interface ShpockMedia {
  id: string;
  width: number;
  height: number;
}

interface ShpockItemSummary {
  __typename: 'ItemSummary';
  id: string;
  title: string;
  price: number | null;
  currency: string | null;
  description: string | null;
  locality: string | null;
  path: string | null;
  isBoosted: boolean;
  isShippable: boolean;
  canonicalURL: string | null;
  media: ShpockMedia[];
}

interface ShpockSummary {
  __typename?: string;
}

interface ShpockItemResult {
  items: (ShpockItemSummary | ShpockSummary)[];
}

interface ShpockSearchResponse {
  data?: {
    itemSearch?: {
      total: number | null;
      itemResults: ShpockItemResult[];
    } | null;
  };
  errors?: Array<{ message: string }>;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class ShpockAdapter extends BaseAdapter {
  source = 'shpock' as const;
  supportLevel = 'full' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_000, retries: 1, ...config });
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this._fetch(query, filters), 'shpock.search');
  }

  private async _fetch(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const results: NormalizedListing[] = [];
    const seenIds = new Set<string>();

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      this.log(`Fetching page ${page + 1} (offset ${offset})`);

      const response = await this.fetchPage(query, filters, offset);
      const itemResults = response?.data?.itemSearch?.itemResults ?? [];

      let pageCount = 0;
      for (const group of itemResults) {
        for (const raw of group.items) {
          if (raw.__typename !== 'ItemSummary') continue;
          const item = raw as ShpockItemSummary;
          if (seenIds.has(item.id)) continue;
          seenIds.add(item.id);
          pageCount++;

          const listing = this.normalize(item);
          if (listing) results.push(listing);
        }
      }

      this.log(`Page ${page + 1}: ${pageCount} items`);
      if (pageCount < PAGE_SIZE) break;
    }

    this.log(`Total unique results: ${results.length}`);
    return results;
  }

  private async fetchPage(
    query: string,
    filters: SearchFilters | undefined,
    offset: number,
  ): Promise<ShpockSearchResponse> {
    const sf: Record<string, unknown> = { q: query };
    if (filters?.priceMin != null || filters?.priceMax != null) {
      sf.price = {
        ...(filters.priceMin != null ? { from: filters.priceMin } : {}),
        ...(filters.priceMax != null ? { to: filters.priceMax } : {}),
      };
    }

    const body = {
      query: `query ItemSearch($pagination: Pagination, $serializedFilters: String) {
        itemSearch(trackingSource: Search, pagination: $pagination, serializedFilters: $serializedFilters) {
          total
          itemResults {
            items {
              __typename
              ... on ItemSummary {
                id title price currency description locality
                path isBoosted isShippable canonicalURL
                media { id width height }
              }
            }
          }
        }
      }`,
      variables: {
        pagination: { limit: PAGE_SIZE, offset },
        serializedFilters: JSON.stringify(sf),
      },
    };

    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': this.config.userAgent,
        'Origin': 'https://www.shpock.com',
        'Referer': 'https://www.shpock.com/de-at/suche',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!res.ok) throw new Error(`shpock HTTP ${res.status}`);
    return res.json() as Promise<ShpockSearchResponse>;
  }

  private normalize(item: ShpockItemSummary): NormalizedListing | null {
    if (!item.id || !item.title) return null;

    const price = typeof item.price === 'number' && item.price > 0 ? item.price : null;
    const imageId = item.media?.[0]?.id ?? null;
    const imageUrl = imageId ? `${IMAGE_BASE}/${imageId}` : null;
    const url = this.resolveUrl(item);
    const conditionText = this.inferConditionFromTitle(item.title)
      ?? this.inferConditionFromTitle(item.description ?? '');

    return {
      id: this.makeId(item.id),
      source: 'shpock',
      sourceListingId: item.id,
      url,
      title: item.title,
      description: item.description ? item.description.slice(0, 400) : null,
      price,
      currency: 'EUR',
      location: item.locality,
      postedAt: null,
      conditionText,
      condition: this.inferCondition(conditionText),
      imageCount: item.media?.length ?? 0,
      imageUrl,
      sellerName: null,
      sellerRating: null,
      sellerReviewCount: null,
      views: null,
      likes: null,
      shippingAvailable: item.isShippable ?? null,
      promoted: item.isBoosted ?? false,
      rawMetadata: { locality: item.locality, currency: item.currency },
    };
  }

  private resolveUrl(item: ShpockItemSummary): string {
    if (item.path) {
      // Replace locale prefix (e.g. /en-gb/ → /de-at/)
      const normalized = item.path.replace(/^\/[a-z]{2}-[a-z]{2}\//, `/${LISTING_LOCALE}/`);
      return `https://www.shpock.com${normalized}`;
    }
    if (item.canonicalURL) {
      return item.canonicalURL.replace(/shpock\.com\/[a-z]{2}-[a-z]{2}\//, `shpock.com/${LISTING_LOCALE}/`);
    }
    return `https://www.shpock.com/${LISTING_LOCALE}/i/${item.id}`;
  }

  private inferConditionFromTitle(text: string): string | null {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (/neu(?:wertig)?|unbenutzt|ungeöffnet|ovp|originalverpackt/.test(lower)) return 'Neu';
    if (/wie neu|nahezu neu|kaum benutzt|fast neu/.test(lower)) return 'Wie neu';
    if (/sehr gut(?:er)? zustand|top zustand|einwandfrei|makellos/.test(lower)) return 'Sehr gut';
    if (/gut(?:er)? zustand|guter zustand|gepflegt/.test(lower)) return 'Gut';
    if (/gebraucht|verwendet/.test(lower)) return 'Gebraucht';
    if (/bastler|defekt|kaputt|reparaturbedürftig/.test(lower)) return 'Defekt';
    return null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return raw.isBoosted === true;
  }

  extractSellerSignals(_raw: Record<string, unknown>) {
    return { sellerName: null, sellerRating: null, sellerReviewCount: null };
  }
}
