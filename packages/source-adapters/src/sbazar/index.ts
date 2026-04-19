/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — Sbazar (sbazar.cz) — owned by Seznam.cz
 *  Rewritten May 2026 — pure HTTP, no Playwright
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  Support level: PARTIAL
 *
 *  Strategy: two attempts, no browser needed
 *    1. RSS feed  — https://www.sbazar.cz/rss?q={query}
 *       Plain XML, no JS required, never OOMs the container.
 *    2. Internal JSON API — https://www.sbazar.cz/api/v1/...
 *       Intercepted from the SPA; tried as fallback.
 *
 *  Both attempts fail gracefully (return []) so the adapter never
 *  throws — no "chyba" badge in the UI even if Sbazar blocks us.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.sbazar.cz';

// Shared fetch headers — look like a real Czech browser
const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

export class SbazarAdapter extends BaseAdapter {
  source = 'sbazar' as const;
  supportLevel = 'partial' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ rateLimitMs: 1_000, timeout: 15_000, retries: 1, ...config });
  }

  buildSearchUrl(query: string, filters?: SearchFilters): string {
    const params = new URLSearchParams({ q: query });
    if (filters?.priceMin != null) params.set('price_from', String(filters.priceMin));
    if (filters?.priceMax != null) params.set('price_to', String(filters.priceMax));
    return `${BASE_URL}/hledej?${params.toString()}`;
  }

  async searchListings(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    // Try RSS first, then JSON API — never throw, return [] on all failures
    try {
      const rssResults = await this.tryRss(query, filters);
      if (rssResults.length > 0) {
        this.log(`RSS returned ${rssResults.length} listings`);
        return rssResults;
      }
    } catch (err) {
      this.log(`RSS attempt failed: ${(err as Error).message}`);
    }

    try {
      const apiResults = await this.tryJsonApi(query, filters);
      if (apiResults.length > 0) {
        this.log(`JSON API returned ${apiResults.length} listings`);
        return apiResults;
      }
    } catch (err) {
      this.log(`JSON API attempt failed: ${(err as Error).message}`);
    }

    this.log('All HTTP strategies returned 0 results');
    return [];
  }

  // ─── Strategy 1: RSS feed ────────────────────────────────────────────────────

  private async tryRss(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    const params = new URLSearchParams({ q: query });
    if (filters?.priceMin != null) params.set('price_from', String(filters.priceMin));
    if (filters?.priceMax != null) params.set('price_to', String(filters.priceMax));

    // Sbazar RSS — several known URL patterns, try them in order
    const rssUrls = [
      `${BASE_URL}/rss?${params.toString()}`,
      `${BASE_URL}/rss/hledej?${params.toString()}`,
      `${BASE_URL}/rss/search?${params.toString()}`,
    ];

    for (const url of rssUrls) {
      this.log(`Trying RSS: ${url}`);
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { ...HEADERS, Accept: 'application/rss+xml, text/xml, */*' },
          signal: AbortSignal.timeout(this.config.timeout),
        });
      } catch {
        continue;
      }

      if (!res.ok) {
        this.log(`RSS ${url} → HTTP ${res.status}`);
        continue;
      }

      const xml = await res.text();
      if (!xml.includes('<item>') && !xml.includes('<item ')) {
        this.log(`RSS ${url} → no <item> elements`);
        continue;
      }

      const listings = this.parseRss(xml);
      this.log(`RSS ${url} → ${listings.length} items parsed`);
      if (listings.length > 0) return listings;
    }

    return [];
  }

  /** Minimal RSS parser — handles the standard RSS 2.0 shape Sbazar uses. */
  private parseRss(xml: string): NormalizedListing[] {
    const results: NormalizedListing[] = [];

    // Extract each <item>…</item> block
    const itemBlocks = [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)];

    for (const block of itemBlocks) {
      const body = block[1];

      const title = this.xmlText(body, 'title');
      const link = this.xmlText(body, 'link') ?? this.xmlText(body, 'guid');
      if (!title || !link) continue;

      // Price — may be in <price:price>, <g:price> or inside <description>
      const priceTag =
        this.xmlText(body, 'price:price') ??
        this.xmlText(body, 'g:price') ??
        this.xmlText(body, 's:price');
      const priceInDesc = body.match(/(\d[\d\s]*)\s*Kč/i)?.[1];
      const price = this.safePrice(
        priceTag ?? (priceInDesc ? priceInDesc.replace(/\s/g, '') : null),
      );

      // Image — <enclosure url="..."/> or <media:content url="..."/>
      const imageUrl =
        body.match(/<enclosure[^>]+url="([^"]+)"/i)?.[1] ??
        body.match(/<media:content[^>]+url="([^"]+)"/i)?.[1] ??
        null;

      // Date
      const pubDate = this.xmlText(body, 'pubDate');
      const postedAt = pubDate ? this.safeDate(pubDate) : null;

      // Location — sometimes in <description> or a custom tag
      const location =
        this.xmlText(body, 'location') ??
        this.xmlText(body, 'city') ??
        null;

      // Extract listing ID from the URL
      const idMatch = link.match(/\/(?:inzerat|detail|nabidka)\/(\d+)/);
      const listingId = idMatch?.[1] ?? link.split('/').filter(Boolean).pop() ?? null;
      if (!listingId) continue;

      const conditionText = this.inferConditionFromTitle(title);

      results.push({
        id: this.makeId(listingId),
        source: 'sbazar',
        sourceListingId: listingId,
        url: link.startsWith('http') ? link : `${BASE_URL}${link}`,
        title,
        description: this.xmlText(body, 'description'),
        price,
        currency: 'CZK',
        location,
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
        shippingAvailable: null,
        promoted: false,
        rawMetadata: { rssSource: true },
      });
    }

    return results;
  }

  /** Pull inner text from the first matching XML element. */
  private xmlText(xml: string, tag: string): string | null {
    const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
      ?? xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
    const raw = m?.[1]?.trim();
    return raw && raw.length > 0 ? raw : null;
  }

  // ─── Strategy 2: internal JSON API ──────────────────────────────────────────

  private async tryJsonApi(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    // Known Sbazar internal API endpoint patterns
    const apiUrls = [
      `${BASE_URL}/api/v1/ads?q=${encodeURIComponent(query)}&limit=40`,
      `${BASE_URL}/api/search?q=${encodeURIComponent(query)}&limit=40`,
    ];

    for (const url of apiUrls) {
      this.log(`Trying JSON API: ${url}`);
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { ...HEADERS, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.config.timeout),
        });
      } catch {
        continue;
      }

      if (!res.ok) {
        this.log(`API ${url} → HTTP ${res.status}`);
        continue;
      }

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        continue;
      }

      const candidates = this.extractCandidates(data);
      if (candidates.length > 0) {
        this.log(`API ${url} → ${candidates.length} items`);
        return candidates.map((c) => this.normalizeApiItem(c as Record<string, unknown>)).filter(Boolean) as NormalizedListing[];
      }
    }

    return [];
  }

  private extractCandidates(data: unknown): unknown[] {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data)) return this.filterListingLike(data);
    const obj = data as Record<string, unknown>;
    for (const key of ['ads', 'items', 'offers', 'results', 'data', 'inzeraty', 'adverts']) {
      const val = obj[key];
      if (Array.isArray(val) && val.length > 0) {
        const filtered = this.filterListingLike(val);
        if (filtered.length > 0) return filtered;
      }
    }
    return [];
  }

  private filterListingLike(arr: unknown[]): unknown[] {
    return arr.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      const o = item as Record<string, unknown>;
      const hasId = o.id !== undefined || o.advertId !== undefined;
      const hasTitle = typeof o.name === 'string' || typeof o.title === 'string';
      return hasId && hasTitle;
    });
  }

  private normalizeApiItem(raw: Record<string, unknown>): NormalizedListing | null {
    const title = (raw.name ?? raw.title ?? raw.subject) as string | undefined;
    if (!title) return null;

    const rawUrl = (raw.url ?? raw.link ?? raw.href) as string | undefined;
    const slug = (raw.seoUrl ?? raw.slug ?? raw.seoName) as string | undefined;
    const id = (raw.id ?? raw.advertId) as string | number | undefined;
    const listingUrl = rawUrl
      ? (rawUrl.startsWith('http') ? rawUrl : `${BASE_URL}${rawUrl}`)
      : slug
        ? `${BASE_URL}/inzerat/${slug}`
        : id
          ? `${BASE_URL}/inzerat/${id}`
          : null;

    if (!listingUrl || !id) return null;
    const listingId = String(id);

    const priceObj = raw.price as Record<string, unknown> | undefined;
    const priceVal = priceObj?.amount ?? priceObj?.value ?? raw.price ?? raw.priceValue;
    const price = typeof priceVal === 'number'
      ? priceVal
      : this.safePrice(String(priceVal ?? ''));

    const locObj = (raw.locality ?? raw.location) as Record<string, unknown> | string | undefined;
    const location = typeof locObj === 'string'
      ? locObj
      : (locObj?.name ?? locObj?.city ?? locObj?.district) as string | undefined ?? null;

    const dateRaw = (raw.date ?? raw.createdAt ?? raw.datePosted ?? raw.insertTime) as string | undefined;
    const postedAt = dateRaw ? (this.safeDate(dateRaw) ?? this.parseCzechRelativeDate(dateRaw)) : null;

    const imgs = raw.images as unknown[] | undefined;
    const firstImg = (Array.isArray(imgs) ? imgs[0] : undefined) as Record<string, unknown> | string | undefined;
    const imageUrl = typeof firstImg === 'string'
      ? firstImg
      : (firstImg?.url ?? firstImg?.src ?? firstImg?.thumb) as string | undefined ?? null;

    const conditionRaw = (raw.condition ?? raw.itemCondition ?? raw.stav) as string | undefined;
    const conditionText = conditionRaw ?? this.inferConditionFromTitle(title);

    return {
      id: this.makeId(listingId),
      source: 'sbazar',
      sourceListingId: listingId,
      url: listingUrl,
      title,
      description: (raw.description ?? raw.text) as string | null ?? null,
      price,
      currency: 'CZK',
      location: location ?? null,
      postedAt,
      conditionText,
      condition: this.inferCondition(conditionText),
      imageCount: Array.isArray(imgs) ? imgs.length : (imageUrl ? 1 : 0),
      imageUrl: imageUrl ?? null,
      sellerName: ((raw.seller as Record<string, unknown>)?.name ?? raw.sellerName) as string | null ?? null,
      sellerRating: null,
      sellerReviewCount: null,
      views: (raw.views ?? raw.viewCount) as number | null ?? null,
      likes: null,
      shippingAvailable: null,
      promoted: !!(raw.top ?? raw.promoted ?? raw.isTop ?? raw.boosted),
      rawMetadata: raw,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private inferConditionFromTitle(text: string): string | null {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (/nerozbalený|nerozbalená|nerozbalené|sealed/.test(lower)) return 'nerozbalený';
    if (/\bnový\b|\bnová\b|\bnové\b|nepoužitý|\bnew\b/.test(lower)) return 'nový';
    if (/jako nový|jako nová|zánovní/.test(lower)) return 'jako nový';
    if (/výborný stav|perfektní stav|bezvadný/.test(lower)) return 'výborný stav';
    if (/dobrý stav|zachovalý|funkční/.test(lower)) return 'dobrý stav';
    if (/opotřebovaný|škrábance|stopy použití/.test(lower)) return 'opotřebovaný';
    if (/poškozený|nefunkční|na díly/.test(lower)) return 'poškozený';
    return null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return !!(raw.isPromoted ?? raw.top ?? raw.promoted);
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    return {
      sellerName: (raw.sellerName as string | null) ?? null,
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
