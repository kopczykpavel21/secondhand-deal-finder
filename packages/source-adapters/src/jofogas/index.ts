import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.jofogas.hu';
const API_URL = 'https://www.jofogas.hu/api/v2/search';

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function parseHufPrice(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^\d]/g, '');
  const parsed = parseInt(cleaned, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseJofogasDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();

  if (lower === 'ma' || lower.startsWith('ma ')) {
    return new Date();
  }

  if (lower === 'tegnap' || lower.startsWith('tegnap ')) {
    return new Date(Date.now() - 86_400_000);
  }

  const minutesMatch = lower.match(/(\d+)\s+perccel\s+ezel/);
  if (minutesMatch) {
    return new Date(Date.now() - Number(minutesMatch[1]) * 60_000);
  }

  const hoursMatch = lower.match(/(\d+)\s+[oó]r[aá]val\s+ezel/);
  if (hoursMatch) {
    return new Date(Date.now() - Number(hoursMatch[1]) * 3_600_000);
  }

  const daysMatch = lower.match(/(\d+)\s+napja/);
  if (daysMatch) {
    return new Date(Date.now() - Number(daysMatch[1]) * 86_400_000);
  }

  const hunMonths: Record<string, number> = {
    jan: 0,
    feb: 1,
    már: 2,
    marc: 2,
    márc: 2,
    ápr: 3,
    máj: 4,
    jún: 5,
    júl: 6,
    aug: 7,
    szep: 8,
    okt: 9,
    nov: 10,
    dec: 11,
  };

  const datePattern = raw.match(/(\d{4})\.\s*([a-záéíóöőúüű]+)\.?\s+(\d{1,2})\./i);
  if (datePattern) {
    const year = parseInt(datePattern[1], 10);
    const monthKey = datePattern[2].toLowerCase().slice(0, 4);
    const day = parseInt(datePattern[3], 10);
    const month = hunMonths[monthKey] ?? hunMonths[monthKey.slice(0, 3)];
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }

  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function extractNextDataListings(data: unknown): Record<string, unknown>[] {
  try {
    const root = data as Record<string, unknown>;
    const props = root?.props as Record<string, unknown> | undefined;
    const pageProps = props?.pageProps as Record<string, unknown> | undefined;

    if (Array.isArray(pageProps?.listings)) {
      return pageProps!.listings as Record<string, unknown>[];
    }

    if (Array.isArray(pageProps?.ads)) {
      return pageProps!.ads as Record<string, unknown>[];
    }

    const searchData = pageProps?.searchData as Record<string, unknown> | undefined;
    if (Array.isArray(searchData?.ads)) {
      return searchData!.ads as Record<string, unknown>[];
    }

    if (Array.isArray(pageProps?.items)) {
      return pageProps!.items as Record<string, unknown>[];
    }
  } catch { }
  return [];
}

function firstImageUrl(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const first = images[0] as Record<string, unknown> | undefined;
  return asStr(first?.url) ?? asStr(first?.src) ?? asStr(first?.uri) ?? null;
}

export class JofogasAdapter extends BaseAdapter {
  source = 'jofogas' as const;
  supportLevel = 'full' as const;
  currency = 'HUF';

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_500, retries: 2, ...config }, getMarketConfig('hu'));
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'jofogas.search');
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
      const slug = encodeURIComponent(query.trim());
      const url = `${BASE_URL}/magyarorszag?q=${slug}&sort=date_sort+desc`;
      this.log(`Fetching page: ${url}`);

      const res = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'hu-HU,hu;q=0.9',
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
          const listings = extractNextDataListings(data);
          if (listings.length > 0) return this.parseListings(listings);
        } catch {
          this.log('Failed to parse __NEXT_DATA__ JSON');
        }
      }

      return this.parseFallback(html);
    } catch {
      return [];
    }
  }

  private async fetchViaApi(query: string, _filters?: SearchFilters): Promise<NormalizedListing[]> {
    try {
      const slug = encodeURIComponent(query.trim());
      const url = `${API_URL}?q=${slug}&sort=date_desc`;
      this.log(`Fetching API: ${url}`);

      const res = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'application/json',
          'Accept-Language': 'hu-HU,hu;q=0.9',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;

      const items = Array.isArray(data.listings)
        ? (data.listings as Record<string, unknown>[])
        : Array.isArray(data.ads)
          ? (data.ads as Record<string, unknown>[])
          : Array.isArray(data.data)
            ? (data.data as Record<string, unknown>[])
            : [];

      return this.parseListings(items);
    } catch {
      return [];
    }
  }

  private parseFallback(html: string): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();
    const hrefPattern = /href="(\/hirdetesek\/[^"]+\/(\d+)[^"]*?)"/gi;

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

      const priceMatch = block.match(/(\d[\d\s.,]*)\s*Ft/i);
      const price = priceMatch ? parseHufPrice(priceMatch[1]) : null;

      results.push({
        id: this.makeId(listingId),
        source: 'jofogas',
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
        shippingAvailable: null,
        promoted: false,
        rawMetadata: { excerpt: block.slice(0, 500) },
      });
    }

    return results;
  }

  private parseListings(listings: Record<string, unknown>[]): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const listing of listings) {
      const listingId = asStr(listing.id) ?? String(listing.id ?? listing.list_id ?? '');
      if (!listingId || listingId === 'undefined' || seen.has(listingId)) continue;
      seen.add(listingId);

      const title = asStr(listing.subject) ?? asStr(listing.title);
      if (!title) continue;

      const priceRaw = listing.price ?? listing.price_value;
      const price =
        asNum(priceRaw) ??
        parseHufPrice(asStr(listing.price)) ??
        (typeof (listing.price as Record<string, unknown>)?.value !== 'undefined'
          ? asNum((listing.price as Record<string, unknown>)?.value) ?? parseHufPrice(asStr((listing.price as Record<string, unknown>)?.value))
          : null);

      const imageUrl = firstImageUrl(listing.images) ?? asStr(listing.thumbnail) ?? asStr(listing.image);

      const location = asStr(
        (listing.location as Record<string, unknown>)?.cityName ??
        (listing.location as Record<string, unknown>)?.city ??
        listing.city ??
        listing.location_name
      );

      const rawDate = asStr(listing.date) ?? asStr(listing.posted_at) ?? asStr(listing.created_at);
      const postedAt = parseJofogasDate(rawDate);

      const conditionText = asStr(listing.condition) ?? asStr(listing.params_label);

      const rawUrl = asStr(listing.url) ?? asStr(listing.vipUrl);
      const adUrl = rawUrl
        ? (rawUrl.startsWith('http') ? rawUrl : `${BASE_URL}${rawUrl}`)
        : `${BASE_URL}/hirdetesek/${listingId}`;

      const sellerName = asStr(
        (listing.seller as Record<string, unknown>)?.name ??
        (listing.owner as Record<string, unknown>)?.name ??
        listing.seller_name
      );

      const promoted =
        listing.highlighted === true ||
        listing.promoted === true ||
        asStr(listing.type) === 'gold' ||
        asStr(listing.priorityProduct) === 'TOPAD';

      results.push({
        id: this.makeId(listingId),
        source: 'jofogas',
        sourceListingId: listingId,
        url: adUrl,
        title,
        description: asStr(listing.body) ?? asStr(listing.description),
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
        shippingAvailable: null,
        promoted,
        rawMetadata: listing,
      });
    }

    return results;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return (
      raw.highlighted === true ||
      raw.promoted === true ||
      asStr(raw.type) === 'gold' ||
      asStr(raw.priorityProduct) === 'TOPAD'
    );
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    const seller = raw.seller as Record<string, unknown> | undefined;
    const owner = raw.owner as Record<string, unknown> | undefined;
    return {
      sellerName: asStr(seller?.name) ?? asStr(owner?.name) ?? asStr(raw.seller_name),
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
