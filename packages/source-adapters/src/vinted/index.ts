/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — Vinted (vinted.cz)
 *  Selectors verified live: April 2026
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  Support level: PARTIAL (upgraded from experimental)
 *
 *  Realistically extractable signals from search cards:
 *    ✅  Title                  [data-testid$="--description-title"]
 *    ✅  Price (CZK)            [data-testid$="--price-text"]
 *    ✅  Condition              [data-testid$="--description-subtitle"] — e.g. "Velmi dobrý"
 *    ✅  Thumbnail image URL    img inside card
 *    ✅  Direct listing URL     a[href*="/items/"]
 *    ✅  Item ID                extracted from data-testid="product-item-id-{ID}"
 *    ✅  Promoted badge         [data-testid$="--bump-text"] → text "Topováno"
 *    ❌  Seller name            not visible on search cards
 *    ❌  Seller rating          not visible on search cards
 *    ❌  Location               not shown on cards
 *    ❌  Posted date            not shown on cards
 *    ❌  Views / likes          not exposed to scrapers
 *
 *  Page characteristics (verified April 2026):
 *    - Vinted CZ uses Next.js with SSR — listings ARE in initial HTML.
 *      domcontentloaded is sufficient; networkidle is safer for lazy tiles.
 *    - Card container: [data-testid="grid-item"]
 *    - Item ID embedded in: [data-testid="product-item-id-{ID}"]
 *    - img alt contains full condition string: "stav: Velmi dobrý"
 *    - URL format: /items/{ID}-{slug}?referrer=catalog
 *    - Cookie consent banner present on first visit — dismissed automatically.
 *    - Vinted monitors traffic; keep rate limit ≥ 3s and randomise UA.
 *
 *  Shipping: Vinted always uses shipping — shippingAvailable: true for all.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';
import type { Page } from 'playwright';

const BASE_URL = 'https://www.vinted.cz';

export class VintedAdapter extends BaseAdapter {
  source = 'vinted' as const;
  supportLevel = 'partial' as const;   // upgraded — condition now available on cards

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 20_000, rateLimitMs: 3_000, ...config });
  }

  buildSearchUrl(query: string, filters?: SearchFilters): string {
    const params = new URLSearchParams({ search_text: query });
    if (filters?.priceMin != null) params.set('price_from', String(filters.priceMin));
    if (filters?.priceMax != null) params.set('price_to', String(filters.priceMax));
    return `${BASE_URL}/catalog?${params.toString()}`;
  }

  async searchListings(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    return this.withRetry(
      () => this._scrape(query, filters),
      'vinted.search',
    );
  }

  private async _scrape(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    const results: NormalizedListing[] = [];

    await this.withPage(async (page: Page) => {
      const url = this.buildSearchUrl(query, filters);
      this.log(`Fetching: ${url}`);

      await page.goto(url, { timeout: this.config.timeout, waitUntil: 'networkidle' });

      // Dismiss cookie/consent banner before grid loads
      await this.dismissConsentBanner(page);

      // Wait for at least one card — [data-testid="grid-item"] confirmed live
      const gridFound = await page
        .waitForSelector('[data-testid="grid-item"]', { timeout: 12_000 })
        .catch(() => null);

      if (!gridFound) {
        this.log('Grid items not found — Vinted may be blocking or layout changed');
        return;
      }

      const rawItems = await page.evaluate(() => {
        const items: Array<Record<string, unknown>> = [];

        // Confirmed live selector — each search result card
        const cards = document.querySelectorAll('[data-testid="grid-item"]');

        cards.forEach((card) => {
          // Item ID is embedded in the product wrapper data-testid
          const productEl = card.querySelector('[data-testid^="product-item-id-"]');
          const itemId = productEl
            ?.getAttribute('data-testid')
            ?.replace('product-item-id-', '') ?? null;

          // Overlay link — always present
          const linkEl = card.querySelector('a[href*="/items/"]');
          const href = linkEl?.getAttribute('href') ?? null;

          // Title  — [data-testid$="--description-title"]
          const titleEl = card.querySelector('[data-testid$="--description-title"]');
          const title = titleEl?.textContent?.trim() ?? null;

          // Price — [data-testid$="--price-text"]
          const priceEl = card.querySelector('[data-testid$="--price-text"]');
          const priceText = priceEl?.textContent?.trim() ?? null;

          // Subtitle format: "XS / 34 / 6 · Dobrý" or "M · Muži · Nový s visačkou"
          // Separator is a middle dot (U+00B7) surrounded by spaces.
          // Last segment = condition; everything before = size (drop gender words).
          const subtitleEl = card.querySelector('[data-testid$="--description-subtitle"]');
          const subtitleRaw = subtitleEl?.textContent?.trim() ?? null;
          let conditionText: string | null = null;
          let size: string | null = null;
          if (subtitleRaw) {
            const parts = subtitleRaw.split(/\s*·\s*/);
            conditionText = parts[parts.length - 1] ?? null;
            // First part is size; skip standalone gender words (Muži, Ženy, Unisex…)
            const GENDER_WORDS = ['muži', 'ženy', 'unisex', 'chlapci', 'dívky', 'děti'];
            const sizePart = parts[0]?.trim() ?? null;
            if (sizePart && !GENDER_WORDS.includes(sizePart.toLowerCase())) {
              size = sizePart;
            }
          }

          // Image — first img in card
          const imgEl = card.querySelector('img');
          const imageUrl = imgEl?.getAttribute('src') ?? null;

          // Likes / hearts count — [data-testid="favourite-count-text"]
          const likesEl = card.querySelector('[data-testid="favourite-count-text"]');
          const likesText = likesEl?.textContent?.trim() ?? null;

          // Promoted badge — "Topováno" text when bumped
          const bumpEl = card.querySelector('[data-testid$="--bump-text"]');
          const isPromoted = bumpEl !== null;

          if (title && href) {
            items.push({
              itemId,
              href,
              title,
              priceText,
              conditionText,
              size,
              likesText,
              imageUrl,
              isPromoted,
            });
          }
        });

        return items;
      });

      this.log(`Found ${rawItems.length} raw items from Vinted`);

      for (const raw of rawItems) {
        const href = raw.href as string;

        // Prefer item ID from data-testid; fall back to URL extraction
        const listingId =
          (raw.itemId as string | null) ?? this.extractListingId(href);
        if (!listingId) continue;

        const price = this.parseVintedPrice(raw.priceText as string | null);
        const conditionText = (raw.conditionText as string | null) ?? null;
        const likes = this.parseLikes(raw.likesText as string | null);
        const size = (raw.size as string | null) ?? null;

        results.push({
          id: this.makeId(listingId),
          source: 'vinted',
          sourceListingId: listingId,
          url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
          title: raw.title as string,
          description: null,
          price,
          currency: 'CZK',
          location: null,          // not on search cards
          postedAt: null,          // not on search cards
          conditionText,
          condition: this.inferCondition(conditionText),
          imageCount: raw.imageUrl ? 1 : 0,
          imageUrl: (raw.imageUrl as string | null) ?? null,
          sellerName: null,        // not on search cards
          sellerRating: null,
          sellerReviewCount: null,
          views: null,
          likes,
          shippingAvailable: true, // Vinted always ships
          promoted: raw.isPromoted === true,
          rawMetadata: { ...raw, size },
        });
      }
    });

    return results;
  }

  // ─── Consent banner ────────────────────────────────────────────────────────

  private async dismissConsentBanner(page: Page): Promise<void> {
    try {
      const btn = await page.$(
        'button[data-testid="accept-all-button"], ' +
        'button:has-text("Přijmout vše"), ' +
        'button:has-text("Accept all")',
      );
      if (btn) {
        await btn.click();
        await page.waitForTimeout(600);
        this.log('Dismissed consent banner');
      }
    } catch {
      // Non-critical — continue without dismissing
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private parseLikes(text: string | null): number | null {
    if (!text) return null;
    const n = parseInt(text.replace(/\s/g, ''), 10);
    return isNaN(n) ? null : n;
  }

  /** Parse Vinted price: "650,00 Kč" or "1 200 Kč" → number */
  private parseVintedPrice(text: string | null): number | null {
    if (!text) return null;
    // Remove currency label and non-numeric chars except comma/dot
    const cleaned = text
      .replace(/kč/gi, '')
      .replace(/\s/g, '')
      .replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) || n <= 0 ? null : n;
  }

  private extractListingId(href: string): string | null {
    const match = href.match(/\/items\/(\d+)/);
    return match?.[1] ?? null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return raw.isPromoted === true;
  }

  extractSellerSignals(_raw: Record<string, unknown>) {
    return {
      sellerName: null,
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
