import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://sprzedajemy.pl';
const MONTHS_PL_SHORT: Record<string, number> = {
  sty: 0,
  lut: 1,
  mar: 2,
  kwi: 3,
  maj: 4,
  cze: 5,
  lip: 6,
  sie: 7,
  wrz: 8,
  paz: 9,
  paź: 9,
  lis: 10,
  gru: 11,
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

function extractPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d,.]/g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstImage(value: unknown): string | null {
  if (typeof value === 'string') return value;
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
    asString(record.url) ??
    asString(record.src) ??
    asString(record.image) ??
    asString(record.thumbnailUrl) ??
    asString(record.contentUrl)
  );
}

function collectStructuredObjects(html: string): Record<string, unknown>[] {
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
      // Ignore malformed JSON payloads.
    }
  }

  return out;
}

export class SprzedajemyAdapter extends BaseAdapter {
  source = 'sprzedajemy' as const;
  supportLevel = 'full' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_000, retries: 1, ...config }, getMarketConfig('pl'));
  }

  buildSearchUrl(query: string, _filters?: SearchFilters): string {
    const slug = encodeURIComponent(query.trim().replace(/\s+/g, '+'));
    return `${BASE_URL}/temat/${slug}`;
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'sprzedajemy.search');
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
      throw new Error(`Sprzedajemy HTTP ${response.status}`);
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

    for (const obj of collectStructuredObjects(html)) {
      const rawUrl = asString(obj.url) ?? asString(obj.href) ?? asString(obj.link);
      const title = asString(obj.name) ?? asString(obj.title);
      if (!rawUrl || !title || !/-nr\d+/i.test(rawUrl)) continue;

      const listingId = this.extractListingId(rawUrl);
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);

      const offers = (obj.offers as Record<string, unknown> | undefined) ?? {};
      const seller = (obj.seller as Record<string, unknown> | undefined) ?? {};
      const address = (obj.address as Record<string, unknown> | undefined) ?? {};
      const description = asString(obj.description);
      const conditionText =
        asString(obj.itemCondition) ??
        asString(obj.condition) ??
        this.extractConditionFromText(`${title} ${description ?? ''}`);
      const imageUrl = firstImage(obj.image) ?? firstImage(obj.images) ?? firstImage(obj.photo);
      const shippingText = `${description ?? ''} ${asString(obj.shippingDetails) ?? ''}`;

      results.push({
        id: this.makeId(listingId),
        source: 'sprzedajemy',
        sourceListingId: listingId,
        url: rawUrl.startsWith('http') ? rawUrl : `${BASE_URL}${rawUrl}`,
        title,
        description,
        price:
          extractPrice(offers.price) ??
          extractPrice((offers.priceSpecification as Record<string, unknown> | undefined)?.price) ??
          extractPrice(obj.price),
        currency: 'PLN',
        location:
          asString(address.addressLocality) ??
          asString(obj.location) ??
          asString(obj.areaServed) ??
          asString(obj.city),
        postedAt:
          this.parsePostedAt(
            asString(obj.datePosted) ??
            asString(obj.dateCreated) ??
            asString(obj.validFrom),
          ),
        conditionText,
        condition: this.inferCondition(conditionText),
        imageCount: imageUrl ? 1 : 0,
        imageUrl,
        sellerName: asString(seller.name) ?? asString(seller.login) ?? null,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: /wysył|wysyl|kurier|paczkomat|odbiór|odbior/i.test(shippingText),
        promoted: this.detectPromoted(obj),
        rawMetadata: obj,
      });
    }

    return results;
  }

  private parseFallback(html: string): NormalizedListing[] {
    const hrefMatches = [
      ...html.matchAll(/href="(\/[^"]*-nr\d+[^"]*|https:\/\/sprzedajemy\.pl\/[^"]*-nr\d+[^"]*)"/gi),
    ];
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const match of hrefMatches) {
      const href = match[1];
      const listingId = this.extractListingId(href);
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);

      const idx = match.index ?? 0;
      const block = html.slice(Math.max(0, idx - 250), Math.min(html.length, idx + 1800));
      const title =
        stripTags(block.match(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/i)?.[1] ?? '') ||
        stripTags(block.match(/aria-label="([^"]{4,220})"/i)?.[1] ?? '') ||
        stripTags(block.match(/<a[^>]*>([\s\S]{4,240}?)<\/a>/i)?.[1] ?? '');

      if (!title) continue;

      const plain = stripTags(block);
      const imageUrl =
        block.match(/<img[^>]+src="([^"]+)"/i)?.[1] ??
        block.match(/<img[^>]+srcset="([^"\s,]+)[^"]*"/i)?.[1] ??
        null;
      const metaSegment = plain.match(
        /(?:Wczoraj|\d{1,2}\s+[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,}\s+\d{1,2}:\d{2}|\d{1,2}\s+[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,}\s+\d{4}(?:\s+\d{1,2}:\d{2})?)\s+(.{0,180})/i,
      )?.[1] ?? null;
      const location = metaSegment?.split('/').pop()?.trim() ?? null;
      const conditionText = this.extractConditionFromText(plain);

      results.push({
        id: this.makeId(listingId),
        source: 'sprzedajemy',
        sourceListingId: listingId,
        url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
        title,
        description: null,
        price: extractPrice(plain.match(/(\d[\d\s,.]*)\s*zł/i)?.[0] ?? null),
        currency: 'PLN',
        location,
        postedAt: this.parsePostedAt(plain),
        conditionText,
        condition: this.inferCondition(conditionText),
        imageCount: imageUrl ? 1 : 0,
        imageUrl,
        sellerName: /osoba prywatna/i.test(plain) ? 'Osoba prywatna' : (/firma/i.test(plain) ? 'Firma' : null),
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: /wysył|wysyl|kurier|paczkomat|odbiór|odbior/i.test(plain),
        promoted: /polecan|promowan|pilne/i.test(plain),
        rawMetadata: { excerpt: plain.slice(0, 500) },
      });
    }

    return results;
  }

  private extractListingId(url: string): string | null {
    const match = url.match(/-nr(\d+)/i);
    return match?.[1] ?? null;
  }

  private extractConditionFromText(text: string): string | null {
    const lower = text.toLowerCase();
    if (/nowy|nowa|nowe|nieużywany|nieuzywany/.test(lower)) return 'nowy';
    if (/jak nowy|jak nowa|stan idealny|bardzo dobry/.test(lower)) return 'bardzo dobry';
    if (/używany|uzywany|dobry stan|ślady użytkowania|slady uzytkowania/.test(lower)) return 'używany';
    if (/uszkodzony|na części|na czesci|do naprawy|niesprawny/.test(lower)) return 'uszkodzony';
    return null;
  }

  private parsePostedAt(text: string | null): Date | null {
    if (!text) return null;

    const relative = this.parseRelativeDate(text);
    if (relative) return relative;

    const short = text.match(/(\d{1,2})\s+([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})\s+(\d{1,2}):(\d{2})/i);
    if (short) {
      const month = MONTHS_PL_SHORT[short[2].toLowerCase()];
      if (month != null) {
        const now = new Date();
        return new Date(now.getFullYear(), month, Number(short[1]), Number(short[3]), Number(short[4]));
      }
    }

    const full = text.match(/(\d{1,2})\s+([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i);
    if (full) {
      const month = MONTHS_PL_SHORT[full[2].toLowerCase()];
      if (month != null) {
        return new Date(
          Number(full[3]),
          month,
          Number(full[1]),
          Number(full[4] ?? 0),
          Number(full[5] ?? 0),
        );
      }
    }

    return this.safeDate(text);
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return /polecan|promowan|pilne/i.test(JSON.stringify(raw));
  }

  extractSellerSignals(_raw: Record<string, unknown>) {
    return { sellerName: null, sellerRating: null, sellerReviewCount: null };
  }
}
