/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — Aukro (aukro.cz)
 *  Strategy: plain HTTP fetch + Angular SSR ng-state parsing.
 *  NO Playwright needed — Aukro embeds the full search payload
 *  inside a <script id="ng-state"> tag on every page, which
 *  means we can read everything without executing JavaScript.
 *
 *  How it works:
 *    1. GET /vysledky-vyhledavani?text={q}&searchAll=true
 *       → Aukro 301-redirects popular queries to /lp/nejkvalitnejsi-{q}
 *    2. Parse <script id="ng-state"> embedded JSON
 *    3. Find the key that contains "searchItemsCommon" — it holds
 *       up to 60 items with rich structured data.
 *
 *  Extractable signals (from the structured JSON, not DOM):
 *    ✅  Title, price (bid + buy-now), image URL
 *    ✅  Item URL  → /item/{seoUrl}-{itemId}
 *    ✅  Condition → attributes["Stav zboží"]
 *    ✅  Location
 *    ✅  Posted date (startingTime)
 *    ✅  Seller name, positive-feedback %, review count
 *    ✅  Watchers count (used as likes signal)
 *    ✅  Free shipping flag
 *    ✅  Promoted (ppHighlight / ppPriorityList)
 *    ❌  Views — not in the API response
 *
 *  Support level: PARTIAL (all main signals available)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://aukro.cz';

// ─── Raw types from the ng-state payload ─────────────────────────────────────

interface AukroMoney {
  amount: number;
  currency: string;
}

interface AukroAttribute {
  attributeId: number;
  attributeName: string;
  attributeValue: string;
  attributeValueId: number;
  position: number;
}

interface AukroSeller {
  userId: number;
  showName: string;
  positiveFeedbackPercentage: number; // 0–1 scale (e.g. 0.9939 = 99.39%)
  feedbackUniqueUserCount: number;
  rating: number;
  starType: string;
  companyAccount: boolean;
}

interface AukroItem {
  itemId: number;
  itemName: string;
  seoUrl: string;
  price?: AukroMoney;
  buyNowPrice?: AukroMoney;
  buyNowActive?: boolean;
  auction?: boolean;
  titleImageUrl?: string;
  location?: string;
  startingTime?: string;
  endingTime?: string;
  freeShipping?: boolean;
  watchersCount?: number;
  pepperLevel?: number;
  ppHighlight?: boolean;
  ppPriorityList?: unknown;
  seller?: AukroSeller;
  attributes?: AukroAttribute[];
}

// ─── Condition mapping ────────────────────────────────────────────────────────
// Aukro "Stav zboží" values → our conditionText labels the scorer understands

const CONDITION_MAP: Record<string, string> = {
  'Nové':      'Nové',
  'Jako nové': 'Jako nové',
  'Velmi dobré': 'Velmi dobrý',
  'Dobré':     'Dobrý',
  'Použité':   'Použité',
  'Opotřebované': 'Opotřebované',
  'Poškozeno': 'Poškozené',
  'Pro díly':  'Na díly',
};

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class AukroAdapter extends BaseAdapter {
  source = 'aukro' as const;
  supportLevel = 'partial' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 20_000, rateLimitMs: 2_000, ...config });
  }

  buildSearchUrl(query: string, _filters?: SearchFilters): string {
    const params = new URLSearchParams({ text: query, searchAll: 'true' });
    return `${BASE_URL}/vysledky-vyhledavani?${params.toString()}`;
  }

  async searchListings(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    return this.withRetry(
      () => this._fetchAndParse(query, filters),
      'aukro.search',
    );
  }

  private async _fetchAndParse(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    const url = this.buildSearchUrl(query, filters);
    this.log(`GET ${url}`);

    const res = await fetch(url, {
      headers: {
        'User-Agent': this.config.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(this.config.timeout),
    });

    this.log(`Final URL: ${res.url} | Status: ${res.status}`);

    if (!res.ok) {
      throw new Error(`Aukro returned HTTP ${res.status}`);
    }

    const html = await res.text();
    return this.extractFromNgState(html, filters);
  }

  private extractFromNgState(
    html: string,
    filters?: SearchFilters,
  ): NormalizedListing[] {
    // Angular embeds SSR transfer state in: <script id="ng-state" type="application/json">{...}</script>
    const match = html.match(/id="ng-state"[^>]*>(\{[\s\S]*?\})<\/script>/);
    if (!match) {
      this.log('ng-state not found — page may not be SSR rendered');
      return [];
    }

    let state: Record<string, unknown>;
    try {
      state = JSON.parse(match[1]);
    } catch {
      this.log('Failed to parse ng-state JSON');
      return [];
    }

    const aukCache = (state['aukCache'] as Record<string, string>) ?? {};
    let rawItems: AukroItem[] = [];

    for (const [cacheKey, cacheVal] of Object.entries(aukCache)) {
      if (!cacheKey.includes('searchItemsCommon')) continue;
      try {
        const parsed = JSON.parse(cacheVal) as { b?: { content?: AukroItem[] } };
        rawItems = parsed?.b?.content ?? [];
        break;
      } catch {
        // try next key
      }
    }

    this.log(`ng-state: found ${rawItems.length} items`);

    // Apply price filters if provided
    const { priceMin, priceMax } = filters ?? {};

    const results: NormalizedListing[] = [];
    for (const raw of rawItems) {
      // Skip pure auctions — only keep "Kup teď" (buy-now) items
      if (!raw.buyNowActive) continue;

      const listing = this.normalizeItem(raw);
      if (!listing) continue;

      if (priceMin != null && listing.price !== null && listing.price < priceMin) continue;
      if (priceMax != null && listing.price !== null && listing.price > priceMax) continue;

      results.push(listing);
    }

    return results;
  }

  private normalizeItem(item: AukroItem): NormalizedListing | null {
    if (!item.itemId || !item.itemName) return null;

    const id = String(item.itemId);

    const url = `${BASE_URL}/${item.seoUrl ?? id}-${id}`;

    // All items here are buy-now — use buyNowPrice directly
    const price = (item.buyNowPrice?.amount ?? 0) > 0
      ? item.buyNowPrice!.amount
      : (item.price?.amount ?? 0) > 0 ? item.price!.amount : null;

    // Condition from structured attributes
    const conditionAttr = item.attributes?.find(
      (a) => a.attributeName === 'Stav zboží',
    );
    const rawConditionText = conditionAttr?.attributeValue ?? null;
    const conditionText = rawConditionText
      ? (CONDITION_MAP[rawConditionText] ?? rawConditionText)
      : null;

    // Seller signals
    const seller = item.seller ?? null;
    const sellerRating =
      seller?.positiveFeedbackPercentage != null
        ? Math.round(seller.positiveFeedbackPercentage * 1000) / 10  // 0.9939 → 99.4
        : null;
    const sellerReviewCount = seller?.feedbackUniqueUserCount ?? null;

    // Promoted: ppHighlight=true or ppPriorityList is non-empty
    const promoted =
      item.ppHighlight === true ||
      (Array.isArray(item.ppPriorityList)
        ? item.ppPriorityList.length > 0
        : !!item.ppPriorityList);

    return {
      id: this.makeId(id),
      source: 'aukro',
      sourceListingId: id,
      url,
      title: item.itemName,
      description: null,
      price,
      currency: 'CZK',
      location: item.location ?? null,
      postedAt: item.startingTime ? new Date(item.startingTime) : null,
      conditionText,
      condition: this.inferCondition(conditionText),
      imageCount: item.titleImageUrl ? 1 : 0,
      imageUrl: item.titleImageUrl ?? null,
      sellerName: seller?.showName ?? null,
      sellerRating,
      sellerReviewCount,
      views: null,
      likes: item.watchersCount ?? null,
      shippingAvailable: item.freeShipping ?? null,
      promoted,
      rawMetadata: {
        auction: item.auction ?? false,
        buyNowActive: item.buyNowActive ?? false,
        pepperLevel: item.pepperLevel ?? 0,
      },
    };
  }

  // ─── SourceAdapter interface stubs ───────────────────────────────────────────

  detectPromoted(raw: Record<string, unknown>): boolean {
    return raw.ppHighlight === true;
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    const seller = raw.seller as AukroSeller | undefined;
    return {
      sellerName: seller?.showName ?? null,
      sellerRating:
        seller?.positiveFeedbackPercentage != null
          ? Math.round(seller.positiveFeedbackPercentage * 1000) / 10
          : null,
      sellerReviewCount: seller?.feedbackUniqueUserCount ?? null,
    };
  }
}
