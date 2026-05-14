import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.blocket.se';
const API_URL = 'https://api.blocket.se/search_bff/v1/content';

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function extractPriceFromBlocket(priceObj: unknown): number | null {
  if (!priceObj || typeof priceObj !== 'object') return null;
  const p = priceObj as Record<string, unknown>;
  const val = asNum(p.value);
  if (val != null) return val;
  const suffix = asStr(p.suffix);
  if (suffix) {
    const cleaned = suffix.replace(/[^\d]/g, '');
    const parsed = parseInt(cleaned, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function extractPriceFromText(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s/g, '').replace(/[^\d]/g, '');
  const parsed = parseInt(cleaned, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstImageFromBlocket(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const first = images[0] as Record<string, unknown> | undefined;
  return asStr(first?.url) ?? null;
}

function firstLocation(locations: unknown): string | null {
  if (!Array.isArray(locations) || locations.length === 0) return null;
  const first = locations[0] as Record<string, unknown> | undefined;
  return asStr(first?.name) ?? null;
}

function extractNextDataItems(data: unknown): Record<string, unknown>[] {
  try {
    const root = data as Record<string, unknown>;
    const props = root?.props as Record<string, unknown> | undefined;
    const pageProps = props?.pageProps as Record<string, unknown> | undefined;

    const apolloState = pageProps?.initialApolloState as Record<string, unknown> | undefined;
    if (apolloState) {
      const items: Record<string, unknown>[] = [];
      for (const val of Object.values(apolloState)) {
        const item = val as Record<string, unknown>;
        if (asStr(item.heading) && item.price != null) {
          items.push(item);
        }
      }
      if (items.length > 0) return items;
    }

    const listings = pageProps?.listings;
    if (Array.isArray(listings)) return listings as Record<string, unknown>[];

    const ads = pageProps?.ads;
    if (Array.isArray(ads)) return ads as Record<string, unknown>[];
  } catch { }
  return [];
}

export class BlocketAdapter extends BaseAdapter {
  source = 'blocket' as const;
  supportLevel = 'full' as const;
  currency = 'SEK';

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_500, retries: 2, ...config }, getMarketConfig('se'));
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'blocket.search');
  }

  private async fetchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const apiResults = await this.fetchViaApi(query, filters);
    if (apiResults.length > 0) {
      this.log(`API returned ${apiResults.length} listings`);
      return apiResults;
    }

    const pageResults = await this.fetchViaPage(query, filters);
    this.log(`Page parse returned ${pageResults.length} listings`);
    return pageResults;
  }

  private async fetchViaApi(query: string, _filters?: SearchFilters): Promise<NormalizedListing[]> {
    try {
      const params = new URLSearchParams({
        q: query,
        status: 'active',
        sort: 'published_date:desc',
        lim: '40',
      });

      const url = `${API_URL}?${params.toString()}`;
      this.log(`Fetching API: ${url}`);

      const res = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'application/json',
          'Accept-Language': 'sv-SE,sv;q=0.9',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      const items = Array.isArray(data.data) ? (data.data as Record<string, unknown>[]) : [];
      return this.parseApiItems(items);
    } catch {
      return [];
    }
  }

  private async fetchViaPage(query: string, _filters?: SearchFilters): Promise<NormalizedListing[]> {
    try {
      const params = new URLSearchParams({ q: query, sort: 'date' });
      const url = `${BASE_URL}/annonser/hela_sverige?${params.toString()}`;
      this.log(`Fetching page: ${url}`);

      const res = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'sv-SE,sv;q=0.9',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!res.ok) return [];
      const html = await res.text();

      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (!match) {
        this.log('No __NEXT_DATA__ found in Blocket page');
        return [];
      }

      try {
        const data = JSON.parse(match[1]);
        const items = extractNextDataItems(data);
        if (items.length > 0) return this.parseNextDataItems(items);
      } catch {
        this.log('Failed to parse __NEXT_DATA__ JSON');
      }

      return [];
    } catch {
      return [];
    }
  }

  private parseApiItems(items: Record<string, unknown>[]): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const listingId = asStr(item.id) ?? String(item.id ?? '');
      if (!listingId || listingId === 'undefined' || seen.has(listingId)) continue;
      seen.add(listingId);

      const title = asStr(item.heading);
      if (!title) continue;

      const price = extractPriceFromBlocket(item.price);

      const imageUrl = firstImageFromBlocket(item.images);
      const location = firstLocation(item.location);

      const postedAt = this.safeDate(asStr(item.published));

      const promoted = item.boosted === true || asStr(item.ad_status) === 'boosted';

      const adUrl = asStr(item.share_url) ?? asStr(item.url) ?? `${BASE_URL}/annons/${listingId}`;

      results.push({
        id: this.makeId(listingId),
        source: 'blocket',
        sourceListingId: listingId,
        url: adUrl.startsWith('http') ? adUrl : `${BASE_URL}${adUrl}`,
        title,
        description: asStr(item.body),
        price,
        currency: this.currency,
        location,
        postedAt,
        conditionText: null,
        condition: this.inferCondition(null),
        imageCount: imageUrl ? 1 : 0,
        imageUrl,
        sellerName: null,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: false,
        promoted,
        rawMetadata: item,
      });
    }

    return results;
  }

  private parseNextDataItems(items: Record<string, unknown>[]): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const listingId = asStr(item.id) ?? asStr(item.ad_id) ?? String(item.id ?? '');
      if (!listingId || listingId === 'undefined' || seen.has(listingId)) continue;
      seen.add(listingId);

      const title = asStr(item.heading) ?? asStr(item.subject);
      if (!title) continue;

      let price: number | null = extractPriceFromBlocket(item.price);
      if (price === null) {
        price = extractPriceFromText(asStr(item.price));
      }

      const imageUrl = firstImageFromBlocket(item.images) ?? asStr(item.main_image);
      const location = firstLocation(item.location) ?? asStr(item.location_name);
      const postedAt = this.safeDate(asStr(item.published) ?? asStr(item.created_at));
      const promoted = item.boosted === true;

      const adUrl = asStr(item.share_url) ?? asStr(item.url) ?? `${BASE_URL}/annons/${listingId}`;

      results.push({
        id: this.makeId(listingId),
        source: 'blocket',
        sourceListingId: listingId,
        url: adUrl.startsWith('http') ? adUrl : `${BASE_URL}${adUrl}`,
        title,
        description: asStr(item.body),
        price,
        currency: this.currency,
        location,
        postedAt,
        conditionText: null,
        condition: this.inferCondition(null),
        imageCount: imageUrl ? 1 : 0,
        imageUrl,
        sellerName: null,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: false,
        promoted,
        rawMetadata: item,
      });
    }

    return results;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return raw.boosted === true || asStr(raw.ad_status) === 'boosted';
  }

  extractSellerSignals(_raw: Record<string, unknown>) {
    return {
      sellerName: null,
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
