import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const API_URL = 'https://api.wallapop.com/api/v3/general/search';
const BASE_URL = 'https://es.wallapop.com';
const FALLBACK_URL = 'https://www.wallapop.com';

const CONDITION_MAP: Record<string, string> = {
  new: 'nuevo',
  as_good_as_new: 'como nuevo',
  good: 'buen estado',
  fair: 'algo de uso',
  has_some_damage: 'algún desperfecto',
};

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function mapCondition(raw: string | null): string | null {
  if (!raw) return null;
  return CONDITION_MAP[raw] ?? raw;
}

export class WallapopAdapter extends BaseAdapter {
  source = 'wallapop' as const;
  supportLevel = 'full' as const;
  currency = 'EUR';

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_500, retries: 2, ...config }, getMarketConfig('es'));
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'wallapop.search');
  }

  private async fetchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const apiResults = await this.fetchViaApi(query, filters);
    if (apiResults.length > 0) {
      this.log(`API returned ${apiResults.length} listings`);
      return apiResults;
    }

    const pageResults = await this.fetchViaPage(query);
    this.log(`Page parse returned ${pageResults.length} listings`);
    return pageResults;
  }

  private async fetchViaApi(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    try {
      const params = new URLSearchParams({
        keywords: query,
        latitude: '40.4168',
        longitude: '-3.7038',
        language: 'es_ES',
        order_by: 'newest',
        start: '0',
        step: '40',
      });

      if (filters?.priceMin != null) params.set('min_sale_price', String(filters.priceMin));
      if (filters?.priceMax != null) params.set('max_sale_price', String(filters.priceMax));

      const res = await fetch(`${API_URL}?${params.toString()}`, {
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'application/json',
          'X-DeviceOS': '0',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      const searchData = (data.data as Record<string, unknown> | undefined);
      const searchObjects = Array.isArray(searchData?.search_objects)
        ? (searchData!.search_objects as Record<string, unknown>[])
        : [];
      const products = searchObjects.filter((o) => o.type === 'product');
      return this.parseItems(products);
    } catch {
      return [];
    }
  }

  private async fetchViaPage(query: string): Promise<NormalizedListing[]> {
    try {
      const params = new URLSearchParams({ keywords: query });
      const url = `${FALLBACK_URL}/app/search?${params.toString()}`;
      this.log(`Fetching fallback page: ${url}`);

      const res = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!res.ok) return [];
      const html = await res.text();

      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (!match) {
        this.log('No __NEXT_DATA__ found in Wallapop page');
        return [];
      }

      const data = JSON.parse(match[1]) as Record<string, unknown>;
      const props = (data.props as Record<string, unknown> | undefined);
      const pageProps = (props?.pageProps as Record<string, unknown> | undefined);
      const items = Array.isArray(pageProps?.items)
        ? (pageProps!.items as Record<string, unknown>[])
        : [];
      return this.parseItems(items);
    } catch {
      return [];
    }
  }

  private parseItems(items: Record<string, unknown>[]): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const content = (item.content as Record<string, unknown> | undefined) ?? item;

      const listingId = asStr(content.id);
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);

      const title = asStr(content.title);
      if (!title) continue;

      const price = asNum(content.price);
      const currency = asStr(content.currency) ?? this.currency;

      const images = content.images as unknown[] | undefined;
      const firstImageObj = Array.isArray(images) ? images[0] as Record<string, unknown> : null;
      const imageUrl = asStr(firstImageObj?.medium) ?? null;

      const location = (content.location as Record<string, unknown> | undefined);
      const locationCity = asStr(location?.city);

      const creationDate = content.creation_date;
      const postedAt = typeof creationDate === 'number'
        ? new Date(creationDate * 1000)
        : this.safeDate(asStr(creationDate));

      const rawCondition = asStr(content.condition);
      const conditionText = mapCondition(rawCondition);

      const webSlug = asStr(content.web_slug);
      const adUrl = webSlug
        ? `${BASE_URL}/item/${webSlug}`
        : asStr(content.url) ?? `${BASE_URL}/item/${listingId}`;

      const views = asNum(content.views);
      const likes = asNum(content.favorited as unknown) ?? null;

      results.push({
        id: this.makeId(listingId),
        source: 'wallapop',
        sourceListingId: listingId,
        url: adUrl,
        title,
        description: asStr(content.description),
        price,
        currency,
        location: locationCity,
        postedAt,
        conditionText,
        condition: this.inferCondition(conditionText),
        imageCount: imageUrl ? 1 : 0,
        imageUrl,
        sellerName: asStr((content.seller as Record<string, unknown> | undefined)?.name ?? content.seller_name),
        sellerRating: null,
        sellerReviewCount: null,
        views: typeof views === 'number' ? views : null,
        likes: typeof likes === 'number' ? likes : null,
        shippingAvailable: content.shipping_allowed === true,
        promoted: content.highlighted === true,
        rawMetadata: content,
      });
    }

    return results;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return raw.highlighted === true;
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    const seller = raw.seller as Record<string, unknown> | undefined;
    return {
      sellerName: asStr(seller?.name ?? raw.seller_name),
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
