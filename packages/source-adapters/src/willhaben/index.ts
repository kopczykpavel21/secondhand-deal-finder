/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — willhaben.at (Austria / southern DE)
 *  Strategy: plain fetch() + __NEXT_DATA__ SSR JSON  (NO Playwright)
 *  Verified live: April 2026
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  How it works:
 *    1. GET /iad/kaufen-und-verkaufen/ergebnisse?keyword={q}
 *    2. Parse <script id="__NEXT_DATA__"> embedded JSON — willhaben
 *       embeds the full first page of results server-side (30 items).
 *    3. Walk props.pageProps.searchResult.advertSummaryList.advertSummary[]
 *
 *  Data shape per listing (all from attributes.attribute[]):
 *    HEADING    → title
 *    PRICE      → price (EUR)
 *    LOCATION   → city
 *    STATE      → Austrian state (province)
 *    CHANGED_String → ISO date string
 *    BODY_DYN   → description
 *    CONDITION_STATE → condition (German: "Neu", "Sehr gut", etc.)
 *
 *  Extractable signals:
 *    ✅  Title, price (EUR), location, description
 *    ✅  Condition (when listed)
 *    ✅  Posted date
 *    ✅  Image URL
 *    ✅  Direct listing URL
 *    ✅  Seller name (advertiserInfo)
 *    ✅  Promoted flag (productId indicates premium placements)
 *    ❌  Seller rating — not in search results
 *    ❌  Views / likes — not exposed
 *
 *  Support level: FULL (clean SSR, very reliable)
 *  Primary market: Austria + cross-border southern Germany
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.willhaben.at';
const RESULTS_PER_PAGE = 30;   // willhaben SSR page size
const MAX_PAGES = 3;            // up to 90 listings

// ─── Raw data types from __NEXT_DATA__ ───────────────────────────────────────

interface WillhabenAttribute {
  name: string;
  values: string[];
}

interface WillhabenImage {
  mainImageUrl: string;
  thumbnailUrl?: string;
}

interface WillhabenAd {
  id: number | string;
  verticalId?: number;
  productId?: number;            // > 0 = premium/promoted
  description?: string;
  attributes: { attribute: WillhabenAttribute[] };
  advertImageList?: { advertImage: WillhabenImage[] };
  selfLink?: string;
  contextLinkList?: Array<{ contextLinkUrl?: string; relativePath?: string }>;
  advertiserInfo?: { label?: string };
}

interface WillhabenPageProps {
  searchResult?: {
    advertSummaryList?: {
      advertSummary?: WillhabenAd[];
    };
    rowsFound?: number;
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class WillhabenAdapter extends BaseAdapter {
  source = 'willhaben' as const;
  supportLevel = 'full' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 12_000, rateLimitMs: 1_000, retries: 1, ...config });
  }

  buildSearchUrl(query: string, filters?: SearchFilters, page = 1): string {
    const params = new URLSearchParams({
      keyword: query,
      rows: String(RESULTS_PER_PAGE),
      page: String(page),
    });
    if (filters?.priceMin != null) params.set('PRICE_FROM', String(filters.priceMin));
    if (filters?.priceMax != null) params.set('PRICE_TO', String(filters.priceMax));
    return `${BASE_URL}/iad/kaufen-und-verkaufen/ergebnisse?${params.toString()}`;
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this._fetch(query, filters), 'willhaben.search');
  }

  private async _fetch(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const results: NormalizedListing[] = [];
    const seenIds = new Set<string>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = this.buildSearchUrl(query, filters, page);
      this.log(`Fetching page ${page}: ${url.slice(0, 80)}…`);

      const html = await this.fetchHtml(url);
      const ads = this.extractAds(html);
      this.log(`Page ${page}: ${ads.length} ads`);

      for (const ad of ads) {
        const id = String(ad.id);
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const listing = this.normalizeAd(ad);
        if (listing) results.push(listing);
      }

      if (ads.length < RESULTS_PER_PAGE) break;
    }

    this.log(`Total unique results: ${results.length}`);
    return results;
  }

  private async fetchHtml(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': this.config.userAgent,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-AT,de;q=0.9',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(this.config.timeout),
    });
    if (!res.ok) throw new Error(`willhaben HTTP ${res.status} for ${url}`);
    return res.text();
  }

  private extractAds(html: string): WillhabenAd[] {
    // Extract __NEXT_DATA__ JSON from the HTML
    const match = html.match(/<script id="__NEXT_DATA__"[^>]+>([\s\S]*?)<\/script>/);
    if (!match) {
      this.log('__NEXT_DATA__ not found in HTML');
      return [];
    }
    try {
      const data = JSON.parse(match[1]);
      const pageProps: WillhabenPageProps = data?.props?.pageProps ?? {};
      return pageProps.searchResult?.advertSummaryList?.advertSummary ?? [];
    } catch (err) {
      this.log(`JSON parse error: ${(err as Error).message}`);
      return [];
    }
  }

  private normalizeAd(ad: WillhabenAd): NormalizedListing | null {
    const attrs = this.attrMap(ad.attributes?.attribute ?? []);

    const title = attrs['HEADING'] ?? ad.description ?? null;
    if (!title) return null;

    const id = String(ad.id);
    const url = this.resolveUrl(ad);
    if (!url) return null;

    // Price
    const priceRaw = attrs['PRICE'];
    const price = priceRaw ? parseFloat(priceRaw) || null : null;

    // Location: "City, State" or just city
    const city = attrs['LOCATION'] ?? null;
    const state = attrs['STATE'] ?? null;
    const location = [city, state].filter(Boolean).join(', ') || null;

    // Date
    const dateStr = attrs['CHANGED_String'] ?? null;
    const postedAt = dateStr ? this.safeDate(dateStr) : null;

    // Description
    const description = attrs['BODY_DYN'] ?? null;

    // Condition
    const conditionRaw = attrs['CONDITION_STATE'] ?? null;
    const conditionText = conditionRaw ?? this.inferConditionFromTitle(title);

    // Image
    const images = ad.advertImageList?.advertImage ?? [];
    const imageUrl = images[0]?.mainImageUrl ?? null;

    // Promoted: productId > 0 indicates paid placement
    const promoted = typeof ad.productId === 'number' && ad.productId > 0;

    // Seller
    const sellerName = ad.advertiserInfo?.label ?? null;

    return {
      id: this.makeId(id),
      source: 'willhaben',
      sourceListingId: id,
      url,
      title,
      description: description ? description.slice(0, 300) : null,
      price,
      currency: 'EUR',
      location,
      postedAt,
      conditionText,
      condition: this.inferCondition(conditionText),
      imageCount: images.length,
      imageUrl,
      sellerName,
      sellerRating: null,
      sellerReviewCount: null,
      views: null,
      likes: null,
      shippingAvailable: null,
      promoted,
      rawMetadata: attrs,
    };
  }

  /** Convert attribute array to a flat {name: firstValue} map. */
  private attrMap(attrs: WillhabenAttribute[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const a of attrs) {
      if (a.name && a.values?.length) map[a.name] = a.values[0];
    }
    return map;
  }

  private resolveUrl(ad: WillhabenAd): string | null {
    if (ad.selfLink) return ad.selfLink;
    const ctx = ad.contextLinkList?.[0];
    if (ctx?.contextLinkUrl) return ctx.contextLinkUrl;
    if (ctx?.relativePath) return `${BASE_URL}${ctx.relativePath}`;
    return null;
  }

  /** Infer condition from German title keywords. */
  private inferConditionFromTitle(text: string): string | null {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (/neu(?:wertig)?|unbenutzt|ungeöffnet|versiegelt/.test(lower)) return 'Neu';
    if (/wie neu|nahezu neu|kaum benutzt|fast neu/.test(lower)) return 'Wie neu';
    if (/sehr gut(?:er)? zustand|top zustand|einwandfrei/.test(lower)) return 'Sehr gut';
    if (/gut(?:er)? zustand|guter zustand|gepflegt/.test(lower)) return 'Gut';
    if (/gebraucht|verwendet/.test(lower)) return 'Gebraucht';
    if (/defekt|kaputt|reparaturbedürftig|bastler/.test(lower)) return 'Defekt';
    return null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return typeof raw.productId === 'number' && (raw.productId as number) > 0;
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    return {
      sellerName: (raw.sellerName as string | null) ?? null,
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
