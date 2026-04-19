/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — Fler.cz
 *  Czech marketplace for handmade & vintage goods.
 *  Strategy: plain HTTP fetch + HTML parsing (no Playwright)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  Support level: PARTIAL
 *
 *  Extractable signals:
 *    ✅  Title
 *    ✅  Price (CZK)
 *    ✅  Image URL
 *    ✅  Direct listing URL
 *    ✅  Seller name
 *    ⚠️  Condition — inferred (most items are new/handmade)
 *    ❌  Posted date (not shown on search cards)
 *    ❌  Location (not shown on search cards)
 *
 *  Search URL:  https://www.fler.cz/zbozi?hledat={query}
 *  Item URL:    https://www.fler.cz/zbozi/{id}-{slug}
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.fler.cz';

const FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
};

// ─── Minimal HTML utilities ───────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/g, '');
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** First capture group of regex applied to html, decoded. */
function extract(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1] ? decodeEntities(m[1].trim()) : null;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class FlerAdapter extends BaseAdapter {
  source = 'fler' as const;
  supportLevel = 'partial' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ rateLimitMs: 1_000, timeout: 15_000, retries: 1, ...config });
  }

  buildSearchUrl(query: string, filters?: SearchFilters): string {
    const params = new URLSearchParams({ hledat: query });
    if (filters?.priceMin != null) params.set('cena_od', String(filters.priceMin));
    if (filters?.priceMax != null) params.set('cena_do', String(filters.priceMax));
    return `${BASE_URL}/zbozi?${params.toString()}`;
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    try {
      return await this._scrape(query, filters);
    } catch (err) {
      this.log(`Fler fetch failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async _scrape(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const url = this.buildSearchUrl(query, filters);
    this.log(`Fetching: ${url}`);

    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!res.ok) {
      this.log(`HTTP ${res.status} from Fler`);
      return [];
    }

    const html = await res.text();
    return this.parseListings(html);
  }

  private parseListings(html: string): NormalizedListing[] {
    const results: NormalizedListing[] = [];

    // ── Find item blocks ─────────────────────────────────────────────────────
    // Fler uses a grid of product cards. We split on known container patterns
    // and try multiple approaches to handle HTML structure changes.

    // Strategy A: split on article or li tags that contain an /zbozi/ link
    const blockPatterns = [
      /<article[^>]*>([\s\S]*?)<\/article>/gi,
      /<li[^>]*class="[^"]*(?:product|item|zbozi|goods)[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
      /<div[^>]*class="[^"]*(?:product|item|zbozi|goods|offer)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    ];

    let blocks: string[] = [];

    for (const pattern of blockPatterns) {
      const found = [...html.matchAll(pattern)]
        .map((m) => m[0])
        .filter((b) => b.includes('/zbozi/'));
      if (found.length >= 2) {
        blocks = found;
        this.log(`Pattern matched ${found.length} blocks`);
        break;
      }
    }

    // Strategy B: split on /zbozi/ links and grab surrounding context
    if (blocks.length === 0) {
      const linkRe = /<a[^>]+href="(\/zbozi\/[^"]+)"[^>]*>([\s\S]{0,600}?)<\/a>/gi;
      for (const m of html.matchAll(linkRe)) {
        // grab some context around the link
        const start = Math.max(0, (m.index ?? 0) - 200);
        const end   = Math.min(html.length, (m.index ?? 0) + m[0].length + 200);
        blocks.push(html.slice(start, end));
      }
      this.log(`Fallback: ${blocks.length} link contexts`);
    }

    if (blocks.length === 0) {
      this.log('No listing blocks found in Fler HTML');
      return [];
    }

    const seen = new Set<string>();

    for (const block of blocks.slice(0, 60)) {
      const listing = this.parseBlock(block);
      if (!listing) continue;
      if (seen.has(listing.id)) continue;
      seen.add(listing.id);
      results.push(listing);
    }

    this.log(`Parsed ${results.length} Fler listings`);
    return results;
  }

  private parseBlock(block: string): NormalizedListing | null {
    // ── URL & ID ──────────────────────────────────────────────────────────────
    const href = extract(block, /href="(\/zbozi\/[^"]+)"/);
    if (!href) return null;

    const fullUrl = `${BASE_URL}${href}`;
    // ID from URL slug: /zbozi/12345-item-name → 12345
    const idMatch = href.match(/\/zbozi\/(\d+)/);
    const listingId = idMatch?.[1] ?? href.replace(/[^a-z0-9]/gi, '').slice(-10);

    // ── Title ─────────────────────────────────────────────────────────────────
    // Try <h2>, <h3>, alt text, then link text
    const title =
      extract(block, /<h[23][^>]*>([\s\S]*?)<\/h[23]>/i) ??
      extract(block, /alt="([^"]{4,100})"/) ??
      extract(block, /<a[^>]+href="\/zbozi\/[^"]*"[^>]*>([\s\S]{3,80}?)<\/a>/i);

    if (!title || stripTags(title).length < 3) return null;
    const cleanTitle = stripTags(title);

    // ── Price ─────────────────────────────────────────────────────────────────
    const priceRaw =
      extract(block, /class="[^"]*(?:price|cena)[^"]*"[^>]*>([\s\S]*?)<\//) ??
      extract(block, /(\d[\d\s]*)\s*Kč/i);
    const price = this.safePrice(priceRaw ? priceRaw.replace(/\s/g, '').replace('Kč', '') : null);

    // ── Image ─────────────────────────────────────────────────────────────────
    const imageUrl =
      extract(block, /src="(https?:\/\/[^"]*fler[^"]*\.(jpg|jpeg|png|webp))"/) ??
      extract(block, /<img[^>]+src="([^"]+\.(jpg|jpeg|png|webp))"/) ??
      null;

    // ── Seller ────────────────────────────────────────────────────────────────
    const sellerName =
      extract(block, /class="[^"]*(?:seller|autor|shop|prodejce)[^"]*"[^>]*>([\s\S]*?)<\//) ??
      null;

    // ── Condition (Fler is mostly handmade = new, vintage = like_new) ─────────
    const lowerBlock = block.toLowerCase();
    let conditionText: string | null = null;
    if (/vintage|starožitnost|antique|retro|použitý|secondhand/.test(lowerBlock)) {
      conditionText = 'vintage';
    } else if (/handmade|ručně|ruční práce|vlastní výroba/.test(lowerBlock)) {
      conditionText = 'nový';
    }

    return {
      id: this.makeId(listingId),
      source: 'fler',
      sourceListingId: listingId,
      url: fullUrl,
      title: cleanTitle,
      description: null,
      price,
      currency: 'CZK',
      location: null,
      postedAt: null,
      conditionText,
      condition: this.inferCondition(conditionText),
      imageCount: imageUrl ? 1 : 0,
      imageUrl,
      sellerName: sellerName ? stripTags(sellerName) : null,
      sellerRating: null,
      sellerReviewCount: null,
      views: null,
      likes: null,
      shippingAvailable: true, // Fler is mostly mail-order
      promoted: false,
      rawMetadata: { source: 'fler' },
    };
  }

  detectPromoted(_raw: Record<string, unknown>): boolean {
    return false;
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    return {
      sellerName: (raw.sellerName as string | null) ?? null,
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
