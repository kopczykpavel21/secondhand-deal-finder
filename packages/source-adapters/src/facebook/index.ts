/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — Facebook Marketplace
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  Support level: EXPERIMENTAL (degraded — login wall blocks most data)
 *
 *  Realistically extractable signals (unauthenticated):
 *    ⚠️  Title — partially, from og:title or visible text BEFORE login redirect
 *    ⚠️  Price — sometimes shown in og:description or visible briefly
 *    ⚠️  Thumbnail — og:image is sometimes available
 *    ❌  Seller information (requires login)
 *    ❌  Location (requires login in most regions)
 *    ❌  Posted date (requires login)
 *    ❌  Condition (requires login)
 *    ❌  Views / likes / engagement (requires login)
 *
 *  Promoted listings:
 *    Facebook Marketplace uses algorithmic ranking and "boosted" listings.
 *    When logged out, we cannot reliably detect boosts.
 *    When logged in (not implemented here), a "Sponsored" label appears.
 *
 *  Scraping notes:
 *    ⚠️  IMPORTANT: Facebook actively blocks unauthenticated access to
 *        Marketplace. Most search URLs redirect to a login wall after
 *        a brief flash of content. As of 2024 this makes reliable
 *        unauthenticated scraping INFEASIBLE without authenticated sessions.
 *
 *    ⚠️  Authenticated scraping via Playwright requires storing real
 *        Facebook session cookies — which raises ToS and security concerns.
 *        This adapter does NOT implement authenticated scraping.
 *
 *    ⚠️  The Meta Graph API does not expose Marketplace listings.
 *
 *  Current implementation strategy:
 *    - Attempt to load the public Marketplace search URL.
 *    - Extract whatever is visible from Open Graph meta tags before redirect.
 *    - Return partial results with clear null fields.
 *    - If the page redirects to login within 3s, return empty array with a log.
 *
 *  RECOMMENDATION:
 *    Replace this adapter with a third-party API aggregator (e.g. Apify,
 *    ScraperAPI) that has already solved the Facebook auth problem.
 *    Leave the adapter interface intact so the replacement is a drop-in.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';
import type { Page } from 'playwright';

const BASE_URL = 'https://www.facebook.com';

export class FacebookAdapter extends BaseAdapter {
  source = 'facebook' as const;
  supportLevel = 'experimental' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 12_000, retries: 1, ...config });
  }

  buildSearchUrl(query: string, filters?: SearchFilters): string {
    const params = new URLSearchParams({
      query: encodeURIComponent(query),
      exact: 'false',
    });
    if (filters?.location) params.set('city', filters.location);
    return `${BASE_URL}/marketplace/search/?${params.toString()}`;
  }

  async searchListings(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    return this.withRetry(
      () => this._scrape(query, filters),
      'facebook.search',
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

      // Navigate — may redirect to login
      await page.goto(url, {
        timeout: this.config.timeout,
        waitUntil: 'domcontentloaded',
      });

      // Detect login redirect
      const currentUrl = page.url();
      if (
        currentUrl.includes('/login') ||
        currentUrl.includes('login_required') ||
        currentUrl.includes('/checkpoint')
      ) {
        this.log(
          'Facebook redirected to login — unauthenticated access blocked. ' +
          'Returning 0 results. See SOURCE REALITY REPORT in adapter file.',
        );
        return;
      }

      // Try to extract items from JSON embedded in __data__ or window.__initialData__
      const jsonData = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const s of scripts) {
          const text = s.textContent ?? '';
          if (text.includes('marketplace_search') && text.includes('"price"')) {
            return text;
          }
        }
        return null;
      });

      if (jsonData) {
        const extracted = this.parseEmbeddedJson(jsonData);
        this.log(`Extracted ${extracted.length} items from embedded JSON`);
        results.push(...extracted);
        return;
      }

      // Fallback: try visible DOM cards (works only if not redirected)
      const rawItems = await page.evaluate(() => {
        const items: Array<Record<string, unknown>> = [];
        const cards = document.querySelectorAll('[data-testid*="marketplace"], [aria-label*="Marketplace"] a');

        cards.forEach((card) => {
          const linkEl = card.tagName === 'A' ? card : card.querySelector('a');
          const titleEl = card.querySelector('[data-testid*="item-title"], span');
          const priceEl = card.querySelector('[data-testid*="item-price"]');
          const imgEl = card.querySelector('img');

          if (titleEl?.textContent && linkEl?.getAttribute('href')) {
            items.push({
              title: titleEl.textContent.trim(),
              href: linkEl.getAttribute('href'),
              priceText: priceEl?.textContent?.trim() ?? null,
              imageUrl: imgEl?.getAttribute('src') ?? null,
              isPromoted: !!card.querySelector('[aria-label*="Sponsored"]'),
            });
          }
        });

        return items;
      });

      this.log(`DOM fallback found ${rawItems.length} items`);

      for (const raw of rawItems) {
        const href = raw.href as string;
        const listingId = this.extractListingId(href);
        if (!listingId) continue;

        results.push({
          id: this.makeId(listingId),
          source: 'facebook',
          sourceListingId: listingId,
          url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
          title: raw.title as string,
          description: null,
          price: this.safePrice(raw.priceText as string | null),
          currency: 'CZK',
          location: null,
          postedAt: null,
          conditionText: null,
          condition: 'unknown',
          imageCount: raw.imageUrl ? 1 : 0,
          imageUrl: (raw.imageUrl as string | null) ?? null,
          sellerName: null,
          sellerRating: null,
          sellerReviewCount: null,
          views: null,
          likes: null,
          shippingAvailable: null,
          promoted: raw.isPromoted === true,
          rawMetadata: raw,
        });
      }
    });

    return results;
  }

  /**
   * Attempt to parse listing data from Facebook's embedded JSON blobs.
   * Facebook embeds serialised Relay store data in <script> tags.
   * This is extremely fragile and will break with FB updates.
   */
  private parseEmbeddedJson(jsonText: string): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    try {
      // Find price/title patterns in the JSON blob using regex (FB JSON is not
      // valid standalone JSON due to multiple concatenated assignments)
      const listingMatches = jsonText.matchAll(
        /"listing_id"\s*:\s*"(\d+)".*?"name"\s*:\s*"([^"]+)".*?"amount"\s*:\s*"([^"]+)"/g,
      );

      for (const m of listingMatches) {
        const [, listingId, title, priceRaw] = m;
        results.push({
          id: this.makeId(listingId),
          source: 'facebook',
          sourceListingId: listingId,
          url: `${BASE_URL}/marketplace/item/${listingId}/`,
          title,
          description: null,
          price: this.safePrice(priceRaw),
          currency: 'CZK',
          location: null,
          postedAt: null,
          conditionText: null,
          condition: 'unknown',
          imageCount: 0,
          imageUrl: null,
          sellerName: null,
          sellerRating: null,
          sellerReviewCount: null,
          views: null,
          likes: null,
          shippingAvailable: null,
          promoted: false,
          rawMetadata: { listingId, title, priceRaw },
        });
      }
    } catch (err) {
      this.log(`Embedded JSON parse failed: ${(err as Error).message}`);
    }
    return results;
  }

  private extractListingId(href: string): string | null {
    const match = href.match(/\/marketplace\/item\/(\d+)/);
    return match?.[1] ?? null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return raw.isPromoted === true;
  }

  extractSellerSignals(_raw: Record<string, unknown>) {
    // Cannot extract seller signals without authentication
    return {
      sellerName: null,
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
