import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.olx.pl';
const MONTHS_PL: Record<string, number> = {
  stycznia: 0,
  lutego: 1,
  marca: 2,
  kwietnia: 3,
  maja: 4,
  czerwca: 5,
  lipca: 6,
  sierpnia: 7,
  wrzesnia: 8,
  września: 8,
  pazdziernika: 9,
  października: 9,
  listopada: 10,
  grudnia: 11,
};

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

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOlxUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `${BASE_URL}${value}`;
  return value;
}

function extractPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d,.]/g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstImage(value: unknown): string | null {
  if (typeof value === 'string') return normalizeOlxUrl(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImage(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return normalizeOlxUrl(
    asString(record.url) ??
    asString(record.src) ??
    asString(record.imageUrl) ??
    firstImage(record.thumbnail)
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
      // Ignore malformed structured payloads.
    }
  }

  return out;
}

export class OlxAdapter extends BaseAdapter {
  source = 'olx' as const;
  supportLevel = 'full' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_000, retries: 1, ...config }, getMarketConfig('pl'));
  }

  buildSearchUrl(query: string, filters?: SearchFilters): string {
    const slug = encodeURIComponent(query.trim());
    const params = new URLSearchParams();
    if (filters?.priceMin != null) params.set('search[filter_float_price:from]', String(filters.priceMin));
    if (filters?.priceMax != null) params.set('search[filter_float_price:to]', String(filters.priceMax));
    if (filters?.location) params.set('search[city_id]', filters.location);
    params.set('search[order]', 'created_at:desc');
    return `${BASE_URL}/oferty/q-${slug}/?${params.toString()}`;
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'olx.search');
  }

  private async fetchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const url = this.buildSearchUrl(query, filters);
    this.log(`Fetching: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': this.config.userAgent,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`OLX HTTP ${response.status}`);
    }

    const html = await response.text();
    const structured = this.parseStructured(html);
    if (structured.length > 0) {
      this.log(`Structured parse returned ${structured.length} listings`);
      return structured;
    }

    const fallback = this.parseFallback(html);
    this.log(`Fallback parse returned ${fallback.length} listings`);
    return fallback;
  }

  private parseStructured(html: string): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const obj of extractStructuredObjects(html)) {
      const rawUrl = asString(obj.url) ?? asString(obj.href) ?? asString(obj.link);
      const title = asString(obj.name) ?? asString(obj.title);
      if (!rawUrl || !title || !rawUrl.includes('/d/oferta/')) continue;

      const listingId = this.extractListingId(rawUrl);
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);

      const offers = (obj.offers as Record<string, unknown> | undefined) ?? {};
      const price =
        extractPrice(offers.price) ??
        extractPrice((offers.priceSpecification as Record<string, unknown> | undefined)?.price) ??
        extractPrice(obj.price);

      const imageUrl =
        firstImage(obj.image) ??
        firstImage(obj.images) ??
        firstImage(obj.photo) ??
        null;

      const rawLocation =
        asString((obj.address as Record<string, unknown> | undefined)?.addressLocality) ??
        asString(obj.location) ??
        asString(obj.city);

      const conditionText =
        asString(obj.itemCondition) ??
        asString(obj.condition) ??
        this.extractConditionFromText(`${title} ${asString(obj.description) ?? ''}`);

      const shippingText = `${asString(obj.description) ?? ''} ${asString(obj.shipping) ?? ''}`;

      results.push({
        id: this.makeId(listingId),
        source: 'olx',
        sourceListingId: listingId,
        url: rawUrl.startsWith('http') ? rawUrl : `${BASE_URL}${rawUrl}`,
        title,
        description: asString(obj.description),
        price,
        currency: 'PLN',
        location: rawLocation,
        postedAt:
          this.parsePostedAt(asString(obj.datePosted) ?? asString(obj.dateCreated)) ??
          this.parsePostedAt(asString(obj.validFrom)),
        conditionText,
        condition: this.inferCondition(conditionText),
        imageCount: imageUrl ? 1 : 0,
        imageUrl,
        sellerName: null,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: /przesyłk|wysyłk|dostaw/i.test(shippingText),
        promoted: this.detectPromoted(obj),
        rawMetadata: obj,
      });
    }

    return results;
  }

  private parseFallback(html: string): NormalizedListing[] {
    const hrefMatches = [...html.matchAll(/href="(\/d\/oferta\/[^"]+|https:\/\/www\.olx\.pl\/d\/oferta\/[^"]+)"/gi)];
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const match of hrefMatches) {
      const href = match[1];
      const listingId = this.extractListingId(href);
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);

      const idx = match.index ?? 0;
      const block = html.slice(Math.max(0, idx - 250), Math.min(html.length, idx + 1400));
      const title =
        stripTags(block.match(/aria-label="([^"]{4,180})"/i)?.[1] ?? '') ||
        stripTags(block.match(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/i)?.[1] ?? '') ||
        stripTags(block.match(/<a[^>]*>([\s\S]{4,220}?)<\/a>/i)?.[1] ?? '');

      if (!title) continue;

      const price = extractPrice(block.match(/(\d[\d\s,.]*)\s*zł/i)?.[0] ?? null);
      const metaLine = stripTags(block);
      const locationDate = metaLine.match(/([A-ZĄĆĘŁŃÓŚŹŻ][A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż .-]+)\s*-\s*([^|]+)/);
      const conditionText = this.extractConditionFromText(metaLine);
      const imageUrl = normalizeOlxUrl(
        block.match(/<img[^>]+src="([^"]+)"/i)?.[1] ??
        block.match(/<img[^>]+srcset="([^"\s,]+)[^"]*"/i)?.[1] ??
        null
      );

      results.push({
        id: this.makeId(listingId),
        source: 'olx',
        sourceListingId: listingId,
        url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
        title,
        description: null,
        price,
        currency: 'PLN',
        location: locationDate?.[1]?.trim() ?? null,
        postedAt: this.parsePostedAt(locationDate?.[2]?.trim() ?? null),
        conditionText,
        condition: this.inferCondition(conditionText),
        imageCount: imageUrl ? 1 : 0,
        imageUrl,
        sellerName: null,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: /przesyłk|wysyłk|dostaw/i.test(metaLine),
        promoted: /promowan/i.test(metaLine),
        rawMetadata: { excerpt: metaLine.slice(0, 500) },
      });
    }

    return results;
  }

  private extractListingId(url: string): string | null {
    const match = url.match(/-ID([A-Za-z0-9]+)\.html/i) ?? url.match(/\/([^/?#]+)\.html/i);
    return match?.[1] ?? null;
  }

  private extractConditionFromText(text: string): string | null {
    const lower = text.toLowerCase();
    if (/nowy|nowa|nowe/.test(lower)) return 'nowy';
    if (/bardzo dobry|jak nowy/.test(lower)) return 'bardzo dobry';
    if (/używany|uzywany|dobry stan/.test(lower)) return 'używany';
    if (/uszkodzony|na części|na czesci|do naprawy/.test(lower)) return 'uszkodzony';
    return null;
  }

  private parsePostedAt(text: string | null): Date | null {
    if (!text) return null;

    const relative = this.parseRelativeDate(text);
    if (relative) return relative;

    const lower = text.toLowerCase();
    const time = lower.match(/(\d{1,2}):(\d{2})/);

    if (/dzisiaj/.test(lower)) {
      const now = new Date();
      if (time) now.setHours(Number(time[1]), Number(time[2]), 0, 0);
      return now;
    }

    if (/wczoraj/.test(lower)) {
      const yesterday = new Date(Date.now() - 86_400_000);
      if (time) yesterday.setHours(Number(time[1]), Number(time[2]), 0, 0);
      return yesterday;
    }

    const absolute = lower.match(/(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})(?:,\s*(\d{1,2}):(\d{2}))?/i);
    if (absolute) {
      const month = MONTHS_PL[absolute[2]];
      if (month != null) {
        return new Date(
          Number(absolute[3]),
          month,
          Number(absolute[1]),
          Number(absolute[4] ?? 0),
          Number(absolute[5] ?? 0),
        );
      }
    }

    return this.safeDate(text);
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    const joined = JSON.stringify(raw);
    return /promowan/i.test(joined);
  }

  extractSellerSignals(_raw: Record<string, unknown>) {
    return { sellerName: null, sellerRating: null, sellerReviewCount: null };
  }
}
