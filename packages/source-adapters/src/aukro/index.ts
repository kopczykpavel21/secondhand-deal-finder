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
import { BaseAdapter } from '../base-adapter.js';

const BASE_URL = 'https://aukro.cz';

/**
 * Pull the raw item array out of an Aukro SEARCH-RESULTS page's ng-state.
 * Exported standalone (parallel to extractDescriptionFromNgState above) so the
 * 2026-08-24 regression -- Aukro switched the `searchItemsCommon` cache entry
 * from a JSON-encoded string to a pre-parsed object on at least some responses,
 * which made the un-guarded `JSON.parse(cacheVal)` throw and get silently
 * swallowed, returning 0 items on every query -- has a regression test that
 * does not depend on mocking fetch(). See aukro.test.ts.
 */
export function extractSearchItemsFromNgState(html: string): AukroItem[] {
  // Angular embeds SSR transfer state in: <script id="ng-state" type="application/json">{...}</script>
  const match = html.match(/id="ng-state"[^>]*>(\{[\s\S]*?\})<\/script>/);
  if (!match) return [];

  let state: Record<string, unknown>;
  try {
    state = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const aukCache = (state['aukCache'] as Record<string, unknown>) ?? {};
  for (const [cacheKey, cacheVal] of Object.entries(aukCache)) {
    if (!cacheKey.includes('searchItemsCommon')) continue;
    // Handle the cache value arriving as either a JSON string or an
    // already-parsed object -- see the doc comment above.
    let parsed: unknown = cacheVal;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        continue;
      }
    }
    return (parsed as { b?: { content?: AukroItem[] } })?.b?.content ?? [];
  }
  return [];
}

/**
 * Pull the free-text description out of an Aukro item DETAIL page's ng-state.
 * Exported standalone (rather than kept as a private method) so it can be unit
 * tested against captured HTML without mocking fetch(). See aukro.test.ts.
 */
export function extractDescriptionFromNgState(html: string): string | null {
  const match = html.match(/id="ng-state"[^>]*>(\{[\s\S]*?\})<\/script>/);
  if (!match) return null;

  let state: Record<string, unknown>;
  try {
    state = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const aukCache = (state['aukCache'] as Record<string, unknown>) ?? {};
  for (const [cacheKey, cacheVal] of Object.entries(aukCache)) {
    if (!cacheKey.includes('offers') || !cacheKey.includes('offer')) continue;
    // The offer-detail cache entry is a pre-parsed object on some responses
    // and a JSON string on others; handle both rather than assuming.
    let detail: unknown = cacheVal;
    if (typeof detail === 'string') {
      try {
        detail = JSON.parse(detail);
      } catch {
        continue;
      }
    }
    const b = (detail as { b?: Record<string, unknown> })?.b;
    const stripped = b?.['descriptionStripped'];
    if (typeof stripped === 'string' && stripped.trim().length > 0) {
      return stripped.trim();
    }
  }
  return null;
}

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
  categoryPath?: Array<{ id: number; name: string; seoUrl: string }>;
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
    // retries: 1 keeps the worst case (20 s + 2 s pause + 20 s = 42 s) inside
    // the coordinator's 55 s per-source deadline; with the default 2 retries
    // (~66 s) a slow Aukro surfaced as "source timed out" instead of retrying.
    super({ timeout: 20_000, rateLimitMs: 2_000, retries: 1, ...config });
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

    // Aukro is behind Cloudflare. It lets ordinary requests through, but can
    // challenge some networks (typically cloud/datacenter IPs). Name that case
    // explicitly rather than reporting a bare 403.
    if (res.headers.get('cf-mitigated') === 'challenge') {
      throw new Error('Aukro blocks automated access from this network (Cloudflare bot challenge)');
    }
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
    const rawItems = extractSearchItemsFromNgState(html);
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
      // Root first: "Počítače a hry > Herní zařízení > … > PlayStation 5".
      // The root node is a catch-all ("Počítače a hry") and is dropped.
      category: item.categoryPath?.length
        ? item.categoryPath.slice(1).map((c) => c.name).join(' > ') || item.categoryPath[0].name
        : null,
      rawMetadata: {
        auction: item.auction ?? false,
        buyNowActive: item.buyNowActive ?? false,
        pepperLevel: item.pepperLevel ?? 0,
      },
    };
  }

  // ─── Detail-page description fetch (research use only) ───────────────────────
  //
  // NOT part of the SourceAdapter interface and NOT called anywhere in the
  // production search path (packages/platform/src/polish-search.ts and the live
  // apps never invoke this). searchListings() always sets description: null
  // because the search-results payload embedded in Aukro's ng-state does not
  // carry item text -- only the item's own detail page does, at
  // GET /backend-web/api/offers/{itemId}/offer inside that page's ng-state.
  //
  // Confirmed compliant against robots.txt on 2026-08-23: `/{seoUrl}-{itemId}`
  // item pages are not in the Disallow list (only account/cart/promo paths are).
  // See apps/research-harvester/SOURCES-COMPLIANCE.md.
  //
  // One HTTP request per listing -- callers are responsible for their own
  // rate limiting across a batch, the same way searchListings leaves batching
  // to the caller.

  async fetchDescription(url: string): Promise<string | null> {
    return this.withRetry(() => this._fetchDescription(url), 'aukro.detail');
  }

  private async _fetchDescription(url: string): Promise<string | null> {
    this.log(`GET (detail) ${url}`);
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
    if (!res.ok) {
      throw new Error(`Aukro detail page returned HTTP ${res.status}`);
    }
    const html = await res.text();
    return this.extractDescriptionFromNgState(html);
  }

  private extractDescriptionFromNgState(html: string): string | null {
    return extractDescriptionFromNgState(html);
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
