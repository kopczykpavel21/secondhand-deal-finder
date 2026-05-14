import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.gumtree.com';

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^\d,.]/g, '').replace(',', '.');
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function firstImage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImage(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return (
    asStr(record.url) ??
    asStr(record.src) ??
    asStr(record.imageUrl) ??
    firstImage(record.thumbnail) ??
    null
  );
}

function extractStructuredObjects(html: string): Record<string, unknown>[] {
  const blocks = [
    ...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
    ...html.matchAll(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/gi),
  ];

  const out: Record<string, unknown>[] = [];

  function visit(value: unknown, depth = 0) {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    out.push(record);
    for (const nested of Object.values(record)) visit(nested, depth + 1);
  }

  for (const block of blocks) {
    try {
      visit(JSON.parse(block[1]));
    } catch {
    }
  }

  return out;
}

function extractListingIdFromUrl(url: string): string | null {
  const match =
    url.match(/\/p\/[^/]+\/(\d+)\.html/i) ??
    url.match(/\/ad\/[^/]+\/(\d+)/i) ??
    url.match(/[?&]ad=([^&]+)/i) ??
    url.match(/\/(\d{8,})/);
  return match?.[1] ?? null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export class GumtreeAdapter extends BaseAdapter {
  source = 'gumtree' as const;
  supportLevel = 'full' as const;
  currency = 'GBP';

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_500, retries: 2, ...config }, getMarketConfig('gb'));
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'gumtree.search');
  }

  private async fetchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const html = await this.fetchPage(query, filters);
    if (!html) return [];

    const structured = this.parseStructured(html);
    if (structured.length > 0) {
      this.log(`Structured parse returned ${structured.length} listings`);
      return structured;
    }

    const fallback = this.parseFallback(html);
    this.log(`Fallback parse returned ${fallback.length} listings`);
    return fallback;
  }

  private async fetchPage(query: string, filters?: SearchFilters): Promise<string | null> {
    try {
      const params = new URLSearchParams({ q: query, sort: 'date' });
      if (filters?.priceMin != null) params.set('minPrice', String(filters.priceMin));
      if (filters?.priceMax != null) params.set('maxPrice', String(filters.priceMax));
      const url = `${BASE_URL}/search?${params.toString()}`;
      this.log(`Fetching: ${url}`);

      const res = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-GB,en;q=0.9',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!res.ok) {
        this.log(`Gumtree HTTP ${res.status}`);
        return null;
      }

      return res.text();
    } catch {
      return null;
    }
  }

  private parseStructured(html: string): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    const objects = extractStructuredObjects(html);

    for (const obj of objects) {
      const type = asStr(obj['@type']);

      if (type === 'ItemList') {
        const items = obj.itemListElement;
        if (!Array.isArray(items)) continue;
        for (const element of items as Record<string, unknown>[]) {
          const item = (element.item as Record<string, unknown> | undefined) ?? element;
          const listing = this.normalizeStructuredItem(item, seen);
          if (listing) results.push(listing);
        }
        continue;
      }

      if (type === 'Product' || type === 'Offer') {
        const listing = this.normalizeStructuredItem(obj, seen);
        if (listing) results.push(listing);
        continue;
      }

      if (obj.props || obj.pageProps) {
        const pageProps = (obj.pageProps as Record<string, unknown> | undefined) ??
          ((obj.props as Record<string, unknown> | undefined)?.pageProps as Record<string, unknown> | undefined);
        if (!pageProps) continue;
        const listings = Array.isArray(pageProps.listings)
          ? (pageProps.listings as Record<string, unknown>[])
          : Array.isArray(pageProps.ads)
            ? (pageProps.ads as Record<string, unknown>[])
            : [];
        for (const item of listings) {
          const listing = this.normalizeNextDataItem(item, seen);
          if (listing) results.push(listing);
        }
      }
    }

    return results;
  }

  private normalizeStructuredItem(item: Record<string, unknown>, seen: Set<string>): NormalizedListing | null {
    const rawUrl = asStr(item.url);
    if (!rawUrl) return null;

    const listingId = extractListingIdFromUrl(rawUrl);
    if (!listingId || seen.has(listingId)) return null;
    seen.add(listingId);

    const title = asStr(item.name) ?? asStr(item.title);
    if (!title) return null;

    const offers = (item.offers as Record<string, unknown> | undefined) ?? {};
    const price =
      asNum(offers.price) ??
      asNum((offers.priceSpecification as Record<string, unknown> | undefined)?.price) ??
      asNum(item.price);

    const imageUrl = firstImage(item.image) ?? firstImage(item.images) ?? null;

    const address = item.address as Record<string, unknown> | undefined;
    const location =
      asStr(address?.addressLocality) ??
      asStr(address?.addressRegion) ??
      asStr(item.location) ??
      null;

    const rawDate = asStr(item.datePosted) ?? asStr(item.dateCreated) ?? asStr(item.validFrom);
    const postedAt = rawDate ? this.safeDate(rawDate) : null;

    const conditionText = asStr(item.itemCondition) ?? asStr(item.condition);
    const adUrl = rawUrl.startsWith('http') ? rawUrl : `${BASE_URL}${rawUrl}`;

    return {
      id: this.makeId(listingId),
      source: 'gumtree',
      sourceListingId: listingId,
      url: adUrl,
      title,
      description: asStr(item.description),
      price,
      currency: asStr(offers.priceCurrency) ?? this.currency,
      location,
      postedAt,
      conditionText,
      condition: this.inferCondition(conditionText),
      imageCount: imageUrl ? 1 : 0,
      imageUrl,
      sellerName: asStr((item.seller as Record<string, unknown> | undefined)?.name ?? item.sellerName),
      sellerRating: null,
      sellerReviewCount: null,
      views: null,
      likes: null,
      shippingAvailable: false,
      promoted: this.detectPromoted(item),
      rawMetadata: item,
    };
  }

  private normalizeNextDataItem(item: Record<string, unknown>, seen: Set<string>): NormalizedListing | null {
    const listingId = asStr(item.id) ?? asStr(item.adId) ?? String(item.id ?? item.adId ?? '');
    if (!listingId || listingId === 'undefined' || seen.has(listingId)) return null;
    seen.add(listingId);

    const title = asStr(item.title);
    if (!title) return null;

    const price = asNum(item.price) ?? asNum((item.priceInfo as Record<string, unknown> | undefined)?.price);
    const imageUrl = firstImage(item.image) ?? firstImage(item.images) ?? firstImage(item.imageUrl) ?? null;
    const location = asStr(item.location) ?? asStr(item.area) ?? null;
    const rawDate = asStr(item.date) ?? asStr(item.postedDate);
    const postedAt = rawDate ? this.safeDate(rawDate) : null;
    const conditionText = asStr(item.condition);

    const rawUrl = asStr(item.url) ?? asStr(item.vipUrl) ?? `/p/ad/${listingId}.html`;
    const adUrl = rawUrl.startsWith('http') ? rawUrl : `${BASE_URL}${rawUrl}`;

    return {
      id: this.makeId(listingId),
      source: 'gumtree',
      sourceListingId: listingId,
      url: adUrl,
      title,
      description: asStr(item.description),
      price,
      currency: this.currency,
      location,
      postedAt,
      conditionText,
      condition: this.inferCondition(conditionText),
      imageCount: imageUrl ? 1 : 0,
      imageUrl,
      sellerName: asStr((item.seller as Record<string, unknown> | undefined)?.name),
      sellerRating: null,
      sellerReviewCount: null,
      views: null,
      likes: null,
      shippingAvailable: false,
      promoted: this.detectPromoted(item),
      rawMetadata: item,
    };
  }

  private parseFallback(html: string): NormalizedListing[] {
    const hrefPattern = /href="(\/p\/[^"]+\/\d+\.html[^"]*)"/gi;
    const hrefMatches = [...html.matchAll(hrefPattern)];
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const match of hrefMatches) {
      const href = match[1];
      const listingId = extractListingIdFromUrl(href);
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);

      const idx = match.index ?? 0;
      const block = html.slice(Math.max(0, idx - 300), Math.min(html.length, idx + 1500));
      const metaLine = stripTags(block);

      const title =
        stripTags(block.match(/aria-label="([^"]{4,180})"/i)?.[1] ?? '') ||
        stripTags(block.match(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/i)?.[1] ?? '') ||
        stripTags(block.match(/<a[^>]*>([\s\S]{4,220}?)<\/a>/i)?.[1] ?? '');

      if (!title) continue;

      const price = asNum(block.match(/£\s*([\d,]+(?:\.\d{2})?)/i)?.[1] ?? null);
      const conditionText = this.extractConditionSignal(metaLine);
      const imageUrl = asStr(block.match(/<img[^>]+src="([^"]+)"/i)?.[1]) ?? null;
      const rawDate = asStr(block.match(/datetime="([^"]+)"/i)?.[1]);
      const postedAt = rawDate ? this.safeDate(rawDate) : null;

      results.push({
        id: this.makeId(listingId),
        source: 'gumtree',
        sourceListingId: listingId,
        url: `${BASE_URL}${href}`,
        title,
        description: null,
        price,
        currency: this.currency,
        location: null,
        postedAt,
        conditionText,
        condition: this.inferCondition(conditionText),
        imageCount: imageUrl ? 1 : 0,
        imageUrl,
        sellerName: null,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: false,
        promoted: /featured|sponsored|promoted/i.test(metaLine),
        rawMetadata: { excerpt: metaLine.slice(0, 500) },
      });
    }

    return results;
  }

  private extractConditionSignal(text: string): string | null {
    const lower = text.toLowerCase();
    if (/\bnew\b/.test(lower)) return 'new';
    if (/nearly new/.test(lower)) return 'nearly new';
    if (/good condition/.test(lower)) return 'good condition';
    if (/fair condition/.test(lower)) return 'fair condition';
    if (/poor condition/.test(lower)) return 'poor condition';
    return null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    const joined = JSON.stringify(raw);
    return /featured|sponsored|promoted/i.test(joined);
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    const seller = raw.seller as Record<string, unknown> | undefined;
    return {
      sellerName: asStr(seller?.name ?? raw.sellerName),
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
