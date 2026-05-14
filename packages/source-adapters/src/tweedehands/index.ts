import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.2dehands.be';
const API_URL = 'https://www.2dehands.be/lrp/api/search';

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function parseTweedehandsDate(
  raw: string | null | undefined,
  safeDate: (s: string | null | undefined) => Date | null,
): Date | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();

  if (lower === 'vandaag' || lower.startsWith('vandaag')) {
    return new Date();
  }

  if (lower === 'gisteren' || lower.startsWith('gisteren')) {
    return new Date(Date.now() - 86_400_000);
  }

  const minutesAgo = lower.match(/(\d+)\s+minuten?\s+geleden/);
  if (minutesAgo) {
    return new Date(Date.now() - Number(minutesAgo[1]) * 60_000);
  }

  const hoursAgo = lower.match(/(\d+)\s+uur\s+geleden/);
  if (hoursAgo) {
    return new Date(Date.now() - Number(hoursAgo[1]) * 3_600_000);
  }

  return safeDate(raw);
}

function buildListingUrl(vipUrl: string | null, itemId: string | number): string {
  if (vipUrl) {
    return vipUrl.startsWith('http') ? vipUrl : `${BASE_URL}${vipUrl}`;
  }
  return `${BASE_URL}/a/${itemId}/`;
}

export class TweedehandsAdapter extends BaseAdapter {
  source = 'tweedehands' as const;
  supportLevel = 'full' as const;
  currency = 'EUR';

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_500, retries: 2, ...config }, getMarketConfig('be'));
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'tweedehands.search');
  }

  private async fetchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const pageResults = await this.fetchViaPage(query, filters);
    if (pageResults.length > 0) {
      this.log(`Page parse returned ${pageResults.length} listings`);
      return pageResults;
    }

    const apiResults = await this.fetchViaApi(query, filters);
    this.log(`API returned ${apiResults.length} listings`);
    return apiResults;
  }

  private async fetchViaPage(query: string, _filters?: SearchFilters): Promise<NormalizedListing[]> {
    try {
      const slug = encodeURIComponent(query.trim().replace(/\s+/g, '-'));
      const url = `${BASE_URL}/q/${slug}/#Language:all-languages`;
      this.log(`Fetching page: ${url}`);

      const res = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'nl-BE,nl;q=0.9,fr;q=0.8',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!res.ok) return [];
      const html = await res.text();

      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (!match) {
        this.log('No __NEXT_DATA__ found in 2dehands page');
        return [];
      }

      const data = JSON.parse(match[1]) as Record<string, unknown>;
      const props = data.props as Record<string, unknown> | undefined;
      const pageProps = props?.pageProps as Record<string, unknown> | undefined;
      const listings = Array.isArray(pageProps?.listings)
        ? (pageProps!.listings as Record<string, unknown>[])
        : [];

      return this.parseListings(listings);
    } catch {
      return [];
    }
  }

  private async fetchViaApi(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    try {
      const params = new URLSearchParams({
        query,
        sortBy: 'SORT_INDEX',
        sortOrder: 'DECREASING',
        size: '30',
      });

      if (filters?.priceMin != null) params.set('priceCentsMin', String(filters.priceMin * 100));
      if (filters?.priceMax != null) params.set('priceCentsMax', String(filters.priceMax * 100));

      const res = await fetch(`${API_URL}?${params.toString()}`, {
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'application/json',
          'Accept-Language': 'nl-BE,nl;q=0.9,fr;q=0.8',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      const listings = Array.isArray(data.listings)
        ? (data.listings as Record<string, unknown>[])
        : [];

      return this.parseListings(listings);
    } catch {
      return [];
    }
  }

  private parseListings(listings: Record<string, unknown>[]): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const listing of listings) {
      const itemId = asStr(listing.itemId) ?? String(listing.itemId ?? '');
      if (!itemId || itemId === 'undefined' || seen.has(itemId)) continue;
      seen.add(itemId);

      const title = asStr(listing.title);
      if (!title) continue;

      const priceInfo = listing.priceInfo as Record<string, unknown> | undefined;
      let price: number | null = null;
      if (priceInfo) {
        const priceCents = asNum(priceInfo.priceCents);
        if (priceCents != null) {
          price = priceCents / 100;
        } else {
          const priceLabel = asStr(priceInfo.priceLabel);
          if (priceLabel) {
            const cleaned = priceLabel.replace(/[^\d,.]/g, '').replace(',', '.');
            const parsed = parseFloat(cleaned);
            if (Number.isFinite(parsed) && parsed > 0) price = parsed;
          }
        }
      }

      const pictures = listing.pictures as unknown[] | undefined;
      const firstPic = Array.isArray(pictures) ? (pictures[0] as Record<string, unknown>) : null;
      const imageUrl = asStr(firstPic?.mediumUrl) ?? null;

      const location = listing.location as Record<string, unknown> | undefined;
      const locationCity = asStr(location?.cityName);

      const rawDate = asStr(listing.date);
      const postedAt = parseTweedehandsDate(rawDate, (s) => this.safeDate(s));

      const conditionText = asStr(listing.condition);

      const vipUrl = asStr(listing.vipUrl);
      const adUrl = buildListingUrl(vipUrl, itemId);

      const seller = listing.seller as Record<string, unknown> | undefined;
      const sellerName = asStr(seller?.name);

      const priorityProduct = asStr(listing.priorityProduct);
      const promoted = priorityProduct != null && priorityProduct.length > 0 && priorityProduct !== 'NONE';

      results.push({
        id: this.makeId(itemId),
        source: 'tweedehands',
        sourceListingId: itemId,
        url: adUrl,
        title,
        description: asStr(listing.description),
        price,
        currency: this.currency,
        location: locationCity,
        postedAt,
        conditionText,
        condition: this.inferCondition(conditionText),
        imageCount: imageUrl ? 1 : 0,
        imageUrl,
        sellerName,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: listing.shipping === true || asStr(listing.shippingOptions) != null,
        promoted,
        rawMetadata: listing,
      });
    }

    return results;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    const priorityProduct = asStr(raw.priorityProduct);
    return priorityProduct != null && priorityProduct.length > 0 && priorityProduct !== 'NONE';
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    const seller = raw.seller as Record<string, unknown> | undefined;
    return {
      sellerName: asStr(seller?.name),
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
