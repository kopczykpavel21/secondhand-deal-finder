import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://allegrolokalnie.pl';

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
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
  return asString(record.url) ?? asString(record.src) ?? asString(record.original);
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

export class AllegroLokalnieAdapter extends BaseAdapter {
  source = 'allegro_lokalnie' as const;
  supportLevel = 'partial' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_000, retries: 1, ...config }, getMarketConfig('pl'));
  }

  buildSearchUrl(query: string, _filters?: SearchFilters): string {
    return `${BASE_URL}/oferty/q/${encodeURIComponent(query.trim())}`;
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'allegro-lokalnie.search');
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
      throw new Error(`Allegro Lokalnie HTTP ${response.status}`);
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
      if (!rawUrl || !title || !rawUrl.includes('/oferta/')) continue;

      const listingId = this.extractListingId(rawUrl);
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);

      const sellingMode = (obj.sellingMode as Record<string, unknown> | undefined) ?? {};
      const buyNow = (sellingMode.buyNow as Record<string, unknown> | undefined) ?? {};
      const delivery = (obj.delivery as Record<string, unknown> | undefined) ?? {};
      const seller = (obj.seller as Record<string, unknown> | undefined) ?? {};

      const price =
        extractPrice(buyNow.price) ??
        extractPrice((buyNow.amount as Record<string, unknown> | undefined)?.amount) ??
        extractPrice(obj.price) ??
        extractPrice((obj.offers as Record<string, unknown> | undefined)?.price);

      const conditionText =
        asString(obj.condition) ??
        asString(obj.itemCondition) ??
        this.extractConditionFromText(`${title} ${asString(obj.description) ?? ''}`);

      results.push({
        id: this.makeId(listingId),
        source: 'allegro_lokalnie',
        sourceListingId: listingId,
        url: rawUrl.startsWith('http') ? rawUrl : `${BASE_URL}${rawUrl}`,
        title,
        description: asString(obj.description),
        price,
        currency: 'PLN',
        location:
          asString((obj.location as Record<string, unknown> | undefined)?.name) ??
          asString(obj.locationName) ??
          asString(obj.city),
        postedAt:
          this.parseRelativeDate(asString(obj.publishedAt)) ??
          this.safeDate(asString(obj.publishedAt) ?? asString(obj.startTime)),
        conditionText,
        condition: this.inferCondition(conditionText),
        imageCount: firstImage(obj.images) ? 1 : 0,
        imageUrl: firstImage(obj.images) ?? firstImage(obj.image),
        sellerName: asString(seller.login) ?? asString(obj.sellerName),
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: extractPrice(obj.watchersCount),
        shippingAvailable: Boolean(
          delivery.available ??
          obj.shipping ??
          /dostaw|wysyłk/i.test(asString(obj.description) ?? ''),
        ),
        promoted: this.detectPromoted(obj),
        rawMetadata: obj,
      });
    }

    return results;
  }

  private parseFallback(html: string): NormalizedListing[] {
    const hrefMatches = [...html.matchAll(/href="(\/oferta\/[^"]+|https:\/\/allegrolokalnie\.pl\/oferta\/[^"]+)"/gi)];
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const match of hrefMatches) {
      const href = match[1];
      const listingId = this.extractListingId(href);
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);

      const idx = match.index ?? 0;
      const block = html.slice(Math.max(0, idx - 250), Math.min(html.length, idx + 1400));
      const plain = stripTags(block);
      const title =
        stripTags(block.match(/aria-label="([^"]{4,200})"/i)?.[1] ?? '') ||
        stripTags(block.match(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/i)?.[1] ?? '') ||
        stripTags(block.match(/<a[^>]*>([\s\S]{4,220}?)<\/a>/i)?.[1] ?? '');
      if (!title) continue;

      const conditionText = this.extractConditionFromText(plain);
      const imageUrl = block.match(/<img[^>]+src="([^"]+)"/i)?.[1] ?? null;

      results.push({
        id: this.makeId(listingId),
        source: 'allegro_lokalnie',
        sourceListingId: listingId,
        url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
        title,
        description: null,
        price: extractPrice(plain.match(/(\d[\d\s,.]*)\s*zł/i)?.[0] ?? null),
        currency: 'PLN',
        location: plain.match(/([A-ZĄĆĘŁŃÓŚŹŻ][A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż .-]+)$/)?.[1] ?? null,
        postedAt: this.parseRelativeDate(plain),
        conditionText,
        condition: this.inferCondition(conditionText),
        imageCount: imageUrl ? 1 : 0,
        imageUrl,
        sellerName: plain.match(/sprzedając[ya]:?\s*([A-Za-z0-9_.-]+)/i)?.[1] ?? null,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: extractPrice(plain.match(/(\d+)\s*obserwuj/i)?.[1] ?? null),
        shippingAvailable: /dostaw|wysyłk/i.test(plain),
        promoted: /promowan/i.test(plain),
        rawMetadata: { excerpt: plain.slice(0, 500) },
      });
    }

    return results;
  }

  private extractListingId(url: string): string | null {
    const match = url.match(/\/oferta\/([^/?#]+)/i);
    return match?.[1] ?? null;
  }

  private extractConditionFromText(text: string): string | null {
    const lower = text.toLowerCase();
    if (/nowy|nowa|nowe/.test(lower)) return 'nowy';
    if (/bardzo dobry|jak nowy/.test(lower)) return 'bardzo dobry';
    if (/dobry|używany|uzywany/.test(lower)) return 'używany';
    if (/uszkodzony|na części|na czesci|do naprawy/.test(lower)) return 'uszkodzony';
    return null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return /promowan/i.test(JSON.stringify(raw));
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    const seller = (raw.seller as Record<string, unknown> | undefined) ?? {};
    return {
      sellerName: asString(seller.login) ?? asString(raw.sellerName),
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
