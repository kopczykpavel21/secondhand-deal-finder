import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.subito.it';

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function extractAds(data: unknown): Record<string, unknown>[] {
  try {
    const root = data as Record<string, unknown>;
    const props = root?.props as Record<string, unknown> | undefined;
    const pageProps = props?.pageProps as Record<string, unknown> | undefined;
    const listingSearch = pageProps?.listingSearch as Record<string, unknown> | undefined;
    if (Array.isArray(listingSearch?.ads)) return listingSearch!.ads as Record<string, unknown>[];
  } catch { }
  return [];
}

function firstImageUrl(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const first = images[0] as Record<string, unknown> | undefined;
  const scale = first?.scale;
  if (Array.isArray(scale) && scale.length > 0) {
    const entry = scale[0] as Record<string, unknown> | undefined;
    return asStr(entry?.uri);
  }
  return null;
}

function extractConditionFromFeatures(features: unknown): string | null {
  if (!Array.isArray(features)) return null;
  for (const f of features) {
    const feature = f as Record<string, unknown>;
    const label = asStr(feature.label)?.toLowerCase() ?? '';
    if (label.includes('condiz') || label.includes('stato')) {
      return asStr(feature.value);
    }
  }
  return null;
}

export class SubitoAdapter extends BaseAdapter {
  source = 'subito' as const;
  supportLevel = 'full' as const;
  currency = 'EUR';

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_500, retries: 2, ...config }, getMarketConfig('it'));
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'subito.search');
  }

  private async fetchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const pageResults = await this.fetchViaPage(query, filters);
    if (pageResults.length > 0) {
      this.log(`Page parse returned ${pageResults.length} listings`);
      return pageResults;
    }
    this.log('Page parse returned 0 listings');
    return [];
  }

  private async fetchViaPage(query: string, _filters?: SearchFilters): Promise<NormalizedListing[]> {
    try {
      const params = new URLSearchParams({ q: query, sort: 'datedesc' });
      const url = `${BASE_URL}/annunci-italia/vendita/usato/?${params.toString()}`;
      this.log(`Fetching page: ${url}`);

      const res = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'it-IT,it;q=0.9',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!res.ok) return [];
      const html = await res.text();

      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (match) {
        try {
          const data = JSON.parse(match[1]);
          const ads = extractAds(data);
          if (ads.length > 0) return this.parseAds(ads);
        } catch {
          this.log('Failed to parse __NEXT_DATA__ JSON');
        }
      }

      const inlineMatch = html.match(/"ads"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
      if (inlineMatch) {
        try {
          const ads = JSON.parse(inlineMatch[1]) as Record<string, unknown>[];
          if (ads.length > 0) return this.parseAds(ads);
        } catch { }
      }

      return this.parseFallback(html);
    } catch {
      return [];
    }
  }

  private parseFallback(html: string): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();
    const hrefPattern = /href="(\/annunci-[^"]+\/(\d+)\.htm[^"]*)"/gi;
    for (const match of html.matchAll(hrefPattern)) {
      const path = match[1];
      const listingId = match[2];
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);

      const idx = match.index ?? 0;
      const block = html.slice(Math.max(0, idx - 200), Math.min(html.length, idx + 1000));
      const titleMatch = block.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i);
      const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim();
      if (!title) continue;

      const priceMatch = block.match(/(\d[\d\s.,]*)\s*€/);
      const price = priceMatch ? this.safePrice(priceMatch[1]) : null;

      results.push({
        id: this.makeId(listingId),
        source: 'subito',
        sourceListingId: listingId,
        url: `${BASE_URL}${path}`,
        title,
        description: null,
        price,
        currency: this.currency,
        location: null,
        postedAt: null,
        conditionText: null,
        condition: this.inferCondition(null),
        imageCount: 0,
        imageUrl: null,
        sellerName: null,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: false,
        promoted: false,
        rawMetadata: { excerpt: block.slice(0, 500) },
      });
    }
    return results;
  }

  private parseAds(ads: Record<string, unknown>[]): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const ad of ads) {
      const urn = asStr(ad.urn) ?? '';
      const listingId = urn.split(':').pop() ?? String(ad.id ?? '');
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);

      const title = asStr(ad.subject);
      if (!title) continue;

      const priceObj = ad.price as Record<string, unknown> | undefined;
      const price = asNum(priceObj?.value);

      const imageUrl = firstImageUrl(ad.images);

      const geo = ad.geo as Record<string, unknown> | undefined;
      const city = geo?.city as Record<string, unknown> | undefined;
      const location = asStr(city?.value);

      const postedAt = this.safeDate(asStr(ad.date));

      const advertiser = ad.advertiser as Record<string, unknown> | undefined;
      const sellerName = asStr(advertiser?.name);

      const conditionText = extractConditionFromFeatures(ad.features);

      const urls = ad.urls as Record<string, unknown> | undefined;
      const defaultPath = asStr(urls?.default);
      const adUrl = defaultPath
        ? (defaultPath.startsWith('http') ? defaultPath : `${BASE_URL}/${defaultPath.replace(/^\//, '')}`)
        : `${BASE_URL}/annunci/${listingId}.htm`;

      const promoted = asStr(ad.type) === 'G';

      results.push({
        id: this.makeId(listingId),
        source: 'subito',
        sourceListingId: listingId,
        url: adUrl,
        title,
        description: null,
        price,
        currency: this.currency,
        location,
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
        shippingAvailable: false,
        promoted,
        rawMetadata: ad,
      });
    }

    return results;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return asStr(raw.type) === 'G';
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    const advertiser = raw.advertiser as Record<string, unknown> | undefined;
    return {
      sellerName: asStr(advertiser?.name),
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
