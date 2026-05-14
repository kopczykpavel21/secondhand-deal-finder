/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — LeBonCoin (leboncoin.fr)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  Strategy: fetch search page → extract __NEXT_DATA__ JSON
 *  Fallback: REST API at api.leboncoin.fr/finder/search (POST)
 *
 *  LeBonCoin is Next.js SSR. The __NEXT_DATA__ blob contains
 *  props.pageProps.searchData.ads[] or props.pageProps.ads[] with:
 *    list_id: number           — unique listing ID
 *    subject: string           — title
 *    price: number[]           — [price] or [] if negociable
 *    images: { small_url, nb_images }
 *    location: { region_name, city }
 *    index_date: string        — ISO datetime posted
 *    has_phone: boolean
 *    urgency_label: string     — 'urgent' or '' for promoted
 *    ad_type: string           — 'offer' | 'demand'
 *
 *  Currency: EUR, locale: fr-FR
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.leboncoin.fr';
const API_URL = 'https://api.leboncoin.fr/finder/search';

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  return null;
}

function firstImg(images: unknown): string | null {
  if (!images || typeof images !== 'object') return null;
  const obj = images as Record<string, unknown>;
  return asStr(obj.small_url) ?? asStr(obj.thumb_url) ?? asStr(obj.url) ?? null;
}

function extractAds(data: unknown): Record<string, unknown>[] {
  const paths = [
    (d: Record<string, unknown>) => (d?.props as Record<string, unknown>)?.pageProps,
    (d: Record<string, unknown>) => ((d?.props as Record<string, unknown>)?.pageProps as Record<string, unknown>)?.searchData,
    (d: Record<string, unknown>) => d?.searchData,
    (d: Record<string, unknown>) => d,
  ];
  for (const path of paths) {
    try {
      const node = path(data as Record<string, unknown>);
      if (!node || typeof node !== 'object') continue;
      const record = node as Record<string, unknown>;
      if (Array.isArray(record.ads)) return record.ads as Record<string, unknown>[];
    } catch { /* ignore */ }
  }
  return [];
}

export class LeBonCoinAdapter extends BaseAdapter {
  source = 'leboncoin' as const;
  supportLevel = 'full' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_500, retries: 2, ...config }, getMarketConfig('fr'));
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'leboncoin.search');
  }

  private async fetchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    // Try REST API first — structured JSON response, more reliable
    const apiResults = await this.fetchViaApi(query, filters);
    if (apiResults.length > 0) {
      this.log(`API returned ${apiResults.length} listings`);
      return apiResults;
    }

    // Fallback: scrape search page for __NEXT_DATA__
    const pageResults = await this.fetchViaPage(query, filters);
    this.log(`Page parse returned ${pageResults.length} listings`);
    return pageResults;
  }

  private async fetchViaApi(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    try {
      const body: Record<string, unknown> = {
        limit: 35,
        filters: {
          keywords: { text: query },
          ranges: {
            ...(filters?.priceMin != null || filters?.priceMax != null ? {
              price: {
                ...(filters.priceMin != null ? { min: filters.priceMin } : {}),
                ...(filters.priceMax != null ? { max: filters.priceMax } : {}),
              }
            } : {}),
          },
          enums: {},
          locations: {},
        },
        sort_by: 'time',
        sort_order: 'desc',
      };

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.config.userAgent,
          'Accept': 'application/json',
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/`,
          'Accept-Language': 'fr-FR,fr;q=0.9',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      return this.parseAds(Array.isArray(data.ads) ? data.ads as Record<string, unknown>[] : []);
    } catch {
      return [];
    }
  }

  private async fetchViaPage(query: string, _filters?: SearchFilters): Promise<NormalizedListing[]> {
    const params = new URLSearchParams({ text: query, sort: 'time', order: 'desc' });
    const url = `${BASE_URL}/recherche?${params.toString()}`;
    this.log(`Fetching page: ${url}`);

    const res = await fetch(url, {
      headers: {
        'User-Agent': this.config.userAgent,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!res.ok) throw new Error(`LeBonCoin HTTP ${res.status}`);
    const html = await res.text();

    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) {
      this.log('No __NEXT_DATA__ found in page');
      return [];
    }

    try {
      const data = JSON.parse(match[1]);
      const ads = extractAds(data);
      return this.parseAds(ads);
    } catch {
      this.log('Failed to parse __NEXT_DATA__ JSON');
      return [];
    }
  }

  private parseAds(ads: Record<string, unknown>[]): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const ad of ads) {
      const listingId = String(ad.list_id ?? ad.id ?? '');
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);

      const title = asStr(ad.subject) ?? asStr(ad.title);
      if (!title) continue;

      const price = asNum(ad.price) ?? asNum(ad.price_cents != null ? (ad.price_cents as number) / 100 : null);
      const location = asStr(
        (ad.location as Record<string, unknown>)?.city ??
        (ad.location as Record<string, unknown>)?.region_name ??
        ad.city
      );

      const indexDate = asStr(ad.index_date) ?? asStr(ad.first_publication_date);
      const postedAt = indexDate ? this.safeDate(indexDate) : null;

      const images = ad.images as Record<string, unknown> | undefined;
      const imageUrl = images ? (firstImg(images) ?? null) : null;
      const imageCount = typeof images?.nb_images === 'number' ? images.nb_images : (imageUrl ? 1 : 0);

      const adUrl = asStr(ad.url) ?? `${BASE_URL}/annonce/${ad.category_id}/${listingId}.htm`;

      const conditionText = asStr(ad.condition) ?? asStr(ad.params_label);

      results.push({
        id: this.makeId(listingId),
        source: 'leboncoin',
        sourceListingId: listingId,
        url: adUrl.startsWith('http') ? adUrl : `${BASE_URL}${adUrl}`,
        title,
        description: asStr(ad.body),
        price,
        currency: 'EUR',
        location,
        postedAt,
        conditionText,
        condition: this.inferCondition(conditionText),
        imageCount,
        imageUrl,
        sellerName: asStr((ad.owner as Record<string, unknown>)?.name ?? ad.owner_name),
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: ad.shippable === true || /livraison|expédition/i.test(asStr(ad.body) ?? ''),
        promoted: asStr(ad.urgency_label) === 'urgent' || ad.highlighted === true,
        rawMetadata: ad,
      });
    }

    return results;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return raw.urgency_label === 'urgent' || raw.highlighted === true;
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    const owner = raw.owner as Record<string, unknown> | undefined;
    return {
      sellerName: asStr(owner?.name ?? raw.owner_name),
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
