/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — Vinted (vinted.cz)
 *  Strategy: plain fetch() → REST API  (NO Playwright needed)
 *  Verified live: April 2026
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  How it works:
 *    1. On first call (or after token expiry) make one GET request to
 *       vinted.cz/catalog.  Vinted issues an anonymous JWT in the
 *       Set-Cookie: access_token_web=... header automatically —
 *       no login required.
 *    2. Reuse that token for all subsequent API calls (valid ~7 days).
 *    3. Call /api/v2/catalog/items?search_text=... with the Bearer token
 *       to get structured JSON — 96 items per page, two pages = up to 192.
 *
 *  Extractable signals (from JSON, not DOM):
 *    ✅  Title, price (CZK), currency
 *    ✅  Condition (status field: "Nový s visačkou", "Dobrý", …)
 *    ✅  Thumbnail image URL
 *    ✅  Direct listing URL
 *    ✅  Item ID
 *    ✅  Promoted flag
 *    ✅  Favourite count (likes)
 *    ✅  View count
 *    ✅  Seller login
 *    ❌  Location — not in catalog API response
 *    ❌  Posted date — not in catalog API response
 *
 *  Support level: FULL (clean API, no scraping needed)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.vinted.cz';
const API_BASE = `${BASE_URL}/api/v2/catalog/items`;
const PER_PAGE = 96; // Vinted's max per page
const PAGES_TO_FETCH = 2; // up to 192 listings

// ─── Anonymous token cache (module-level, shared across requests) ─────────────
// Vinted issues anonymous JWTs valid for 7 days.  We cache the token to avoid
// fetching a new one on every search request.

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;

async function getAnonToken(): Promise<string> {
  // Return cached token if still valid (with 5-minute safety margin)
  if (tokenCache && Date.now() < tokenCache.expiresAt - 5 * 60_000) {
    return tokenCache.token;
  }

  // Fetch a fresh anonymous token by visiting the catalog page.
  // Vinted automatically sets access_token_web in the Set-Cookie header.
  const res = await fetch(`${BASE_URL}/catalog?search_text=a`, {
    method: 'GET',
    redirect: 'manual', // don't follow — we only need the headers
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'cs-CZ,cs;q=0.9',
    },
    signal: AbortSignal.timeout(10_000),
  });

  // Parse Set-Cookie headers for access_token_web
  const setCookie = res.headers.get('set-cookie') ?? '';
  const token = extractCookie(setCookie, 'access_token_web');

  if (!token) {
    throw new Error('Vinted: could not obtain anonymous access token');
  }

  // Parse expiry from JWT payload (middle base64 segment)
  let expiresAt = Date.now() + 7 * 24 * 60 * 60_000; // default: 7 days
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    if (payload.exp) expiresAt = payload.exp * 1_000;
  } catch {
    // ignore — use default expiry
  }

  tokenCache = { token, expiresAt };
  return token;
}

/** Extract a named cookie value from a (potentially multi-value) Set-Cookie string. */
function extractCookie(raw: string, name: string): string | null {
  // Set-Cookie values may come as one header with multiple entries separated
  // by newlines (node fetch) or as a single continuous string (curl style).
  const parts = raw.split(/,(?=[^;]+=[^;])/); // rough cookie boundary split
  for (const part of parts) {
    const match = part.match(new RegExp(`(?:^|\\s)${name}=([^;]+)`));
    if (match) return match[1].trim();
  }
  return null;
}

// ─── Vinted API response types ────────────────────────────────────────────────

interface VintedPrice {
  amount: string;
  currency_code: string;
}

interface VintedPhoto {
  url: string;
  thumbnails?: Array<{ type: string; url: string }>;
}

interface VintedUser {
  id: number;
  login: string;
  profile_url: string;
}

interface VintedItem {
  id: number;
  title: string;
  price: VintedPrice;
  url: string;
  path: string;
  status: string;          // condition: "Nový s visačkou", "Dobrý", "Velmi dobrý", …
  photo: VintedPhoto;
  photos: VintedPhoto[];
  favourite_count: number;
  view_count: number;
  promoted: boolean;
  user: VintedUser;
  brand_title?: string;
  size_title?: string;
}

interface VintedApiResponse {
  items: VintedItem[];
  pagination?: { total_pages: number; current_page: number };
  code?: number;
  message?: string;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class VintedAdapter extends BaseAdapter {
  source = 'vinted' as const;
  supportLevel = 'full' as const; // clean API, very reliable

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_000, ...config });
  }

  buildSearchUrl(query: string, filters?: SearchFilters, page = 1): string {
    const params = new URLSearchParams({
      search_text: query,
      per_page: String(PER_PAGE),
      page: String(page),
    });
    if (filters?.priceMin != null) params.set('price_from', String(filters.priceMin));
    if (filters?.priceMax != null) params.set('price_to', String(filters.priceMax));
    return `${API_BASE}?${params.toString()}`;
  }

  async searchListings(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    return this.withRetry(
      () => this._fetch(query, filters),
      'vinted.search',
    );
  }

  private async _fetch(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    const token = await getAnonToken();
    this.log(`Token acquired (${token.slice(0, 20)}…)`);

    const results: NormalizedListing[] = [];
    const seenIds = new Set<string>();

    for (let page = 1; page <= PAGES_TO_FETCH; page++) {
      const url = this.buildSearchUrl(query, filters, page);
      this.log(`Fetching page ${page}: ${url.slice(0, 80)}…`);

      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'cs-CZ,cs;q=0.9',
          'Referer': BASE_URL,
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (res.status === 401) {
        // Token expired mid-run — invalidate cache and retry once
        tokenCache = null;
        throw new Error('Vinted: token expired (401) — will refresh on retry');
      }
      if (!res.ok) {
        throw new Error(`Vinted: HTTP ${res.status} on page ${page}`);
      }

      const data = (await res.json()) as VintedApiResponse;
      const items = data.items ?? [];
      this.log(`Page ${page}: ${items.length} items`);

      for (const item of items) {
        const id = String(item.id);
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const price = parseFloat(item.price?.amount ?? '0') || null;
        const conditionText = item.status ?? null;
        const imageUrl = this.bestPhoto(item);

        results.push({
          id: this.makeId(id),
          source: 'vinted',
          sourceListingId: id,
          url: item.url ?? `${BASE_URL}${item.path}`,
          title: item.title,
          description: null,
          price,
          currency: item.price?.currency_code ?? 'CZK',
          location: null,
          postedAt: null,
          conditionText,
          condition: this.inferCondition(conditionText),
          imageCount: item.photos?.length ?? (imageUrl ? 1 : 0),
          imageUrl,
          sellerName: item.user?.login ?? null,
          sellerRating: null,
          sellerReviewCount: null,
          views: item.view_count ?? null,
          likes: item.favourite_count ?? null,
          shippingAvailable: true, // Vinted always ships
          promoted: item.promoted ?? false,
          rawMetadata: { brandTitle: item.brand_title, sizeTitle: item.size_title },
        });
      }

      // If last page returned fewer than PER_PAGE, no more pages exist
      if (items.length < PER_PAGE) break;
    }

    this.log(`Total unique results: ${results.length}`);
    return results;
  }

  /** Pick the best thumbnail URL from a Vinted item's photo data. */
  private bestPhoto(item: VintedItem): string | null {
    // Prefer 310x430 thumbnail; fall back to main photo URL
    const thumb = item.photo?.thumbnails?.find((t) => t.type === 'thumb310x430');
    return thumb?.url ?? item.photo?.url ?? null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return raw.promoted === true;
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    return {
      sellerName: (raw.sellerName as string | null) ?? null,
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
