import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.olx.pl';
const API_URL = 'https://www.olx.pl/api/v1';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/[^\d.]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function extractPhotoUrl(photos: unknown): string | null {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const first = photos[0] as Record<string, unknown>;
  // OLX API returns photos as [{link: "...", ...}]
  const link = asString(first.link) ?? asString(first.url) ?? asString(first.src);
  return link;
}

export class OlxAdapter extends BaseAdapter {
  source = 'olx' as const;
  supportLevel = 'full' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_000, retries: 1, ...config }, getMarketConfig('pl'));
  }

  buildSearchUrl(query: string, filters?: SearchFilters): string {
    const params = new URLSearchParams({
      query: query.trim(),
      limit: '40',
      sort_by: 'created_at:desc',
      currency: 'PLN',
    });
    if (filters?.priceMin != null) params.set('filter_float_price:from', String(filters.priceMin));
    if (filters?.priceMax != null) params.set('filter_float_price:to', String(filters.priceMax));
    return `${API_URL}/offers/?${params.toString()}`;
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'olx.search');
  }

  private async fetchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const url = this.buildSearchUrl(query, filters);
    this.log(`Fetching API: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
        'Referer': 'https://www.olx.pl/',
        'Origin': 'https://www.olx.pl',
        'x-platform': 'web',
      },
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`OLX HTTP ${response.status}`);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const data = json.data;
    if (!Array.isArray(data)) {
      this.log('OLX API returned unexpected shape');
      return [];
    }

    this.log(`OLX API returned ${data.length} items`);
    return data.flatMap((item) => this.normalizeItem(item as Record<string, unknown>));
  }

  private normalizeItem(item: Record<string, unknown>): NormalizedListing[] {
    const id = asString(item.id) ?? asString(String(item.id));
    const url = asString(item.url);
    const title = asString(item.title);
    if (!id || !url || !title) return [];

    const params = item.params as Record<string, unknown>[] | undefined;
    const priceParam = Array.isArray(params)
      ? params.find((p) => (p as Record<string, unknown>).key === 'price')
      : undefined;
    const priceValue = (priceParam as Record<string, unknown> | undefined)?.value as Record<string, unknown> | undefined;
    const price =
      asNumber(priceValue?.value) ??
      asNumber((item.price as Record<string, unknown> | undefined)?.value) ??
      asNumber(item.price);

    const photos = item.photos as unknown;
    const imageUrl = extractPhotoUrl(photos);

    const locationObj = item.location as Record<string, unknown> | undefined;
    const cityObj = locationObj?.city as Record<string, unknown> | undefined;
    const location = asString(cityObj?.name) ?? asString(locationObj?.city) ?? asString(item.location) ?? null;

    const postedAtStr = asString(item.created_time) ?? asString(item.last_refresh_time);
    const postedAt = this.safeDate(postedAtStr);

    const categoryObj = item.category as Record<string, unknown> | undefined;
    const description = asString((item.description as Record<string, unknown> | undefined)?.text) ?? null;
    const conditionParam = Array.isArray(params)
      ? params.find((p) => (p as Record<string, unknown>).key === 'state')
      : undefined;
    const conditionText = asString((conditionParam as Record<string, unknown> | undefined)?.value_name) ?? null;

    const isPromoted = Boolean(item.promotion) || /promoted|top_ad/i.test(JSON.stringify(item.status ?? ''));
    const shippingText = JSON.stringify(item.delivery ?? '');

    const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;

    return [{
      id: this.makeId(id),
      source: 'olx',
      sourceListingId: id,
      url: fullUrl,
      title,
      description,
      price,
      currency: 'PLN',
      location,
      postedAt,
      conditionText,
      condition: this.inferCondition(conditionText),
      imageCount: Array.isArray(photos) ? photos.length : (imageUrl ? 1 : 0),
      imageUrl,
      sellerName: asString((item.user as Record<string, unknown> | undefined)?.name) ?? null,
      sellerRating: null,
      sellerReviewCount: null,
      views: null,
      likes: null,
      shippingAvailable: /courier|dostawa|wysyłk|przesyłk/i.test(shippingText),
      promoted: isPromoted,
      rawMetadata: { id, category: categoryObj?.id },
    }];
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return /promoted|top_ad/i.test(JSON.stringify(raw));
  }

  extractSellerSignals(_raw: Record<string, unknown>) {
    return { sellerName: null, sellerRating: null, sellerReviewCount: null };
  }
}
