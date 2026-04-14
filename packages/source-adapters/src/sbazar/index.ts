/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — Sbazar (sbazar.cz) — owned by Seznam.cz
 *  Rewritten April 2026 — dual-strategy: API intercept + DOM anchor
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  Support level: PARTIAL
 *
 *  ⚠  Sbazar is a full React SPA — listings are NOT in the initial HTML.
 *     They load via an internal XHR/fetch call after page render.
 *     Strategy:
 *       1. PRIMARY — listen for any JSON response that looks like listing
 *          data (has array of items with 'id' + 'name'/'title' fields).
 *          This works regardless of the exact internal API URL.
 *       2. FALLBACK — after page settles, anchor on `a[href*="/inzerat/"]`
 *          links (Sbazar's known listing URL pattern) and walk up to
 *          scrape the surrounding card for price / location / date.
 *
 *  Realistically extractable signals:
 *    ✅  Title
 *    ✅  Price (CZK)
 *    ✅  Location (city-level)
 *    ✅  Posted date (relative or absolute)
 *    ✅  Thumbnail image URL
 *    ✅  Direct listing URL
 *    ⚠️  Condition: NOT shown on cards — inferred from title keywords
 *    ⚠️  Seller name: visible in some layouts
 *    ⚠️  Promoted badge: .c-item--top / data-top / "Topováno" text
 *    ❌  Seller rating / reviews (Sbazar has no public reputation system)
 *    ❌  Views / likes (not on cards)
 *    ❌  Shipping (not on cards)
 *
 *  URL pattern for listings: /inzerat/{numericId}-{slug}
 *  Search URL: https://www.sbazar.cz/hledej?q={query}
 *  Rate limit: keep >= 2 s between requests (Seznam.cz is generally
 *  scraper-tolerant but watches for high-frequency bursts).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';
import type { Page, Response } from 'playwright';

const BASE_URL = 'https://www.sbazar.cz';

export class SbazarAdapter extends BaseAdapter {
  source = 'sbazar' as const;
  supportLevel = 'partial' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ rateLimitMs: 2_000, ...config });
  }

  buildSearchUrl(_query: string, _filters?: SearchFilters): string {
    // Sbazar is an Astro SPA — direct URL parameters don't work for search.
    // We navigate to the homepage and submit the search form instead.
    return BASE_URL;
  }

  async searchListings(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    return this.withRetry(
      () => this._scrape(query, filters),
      'sbazar.search',
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

      // ── Strategy 1: intercept JSON API response ─────────────────────────────
      // Sbazar fires multiple XHR calls as the page loads (homepage data, then
      // search results). We collect ALL matching JSON responses and then pick
      // the best one: prefer a response whose URL contains the search query,
      // fall back to whichever response has the most items.
      const interceptedResponses: Array<{ respUrl: string; items: unknown[] }> = [];

      const onResponse = async (response: Response) => {
        try {
          const ct = response.headers()['content-type'] ?? '';
          if (!ct.includes('json') || !response.ok()) return;

          const respUrl = response.url();
          // Skip static assets and known tracking domains
          if (/\.(js|css|png|jpg|svg|woff|gif|ico)/i.test(respUrl)) return;
          if (/gtm\.|googletagmanager|hotjar|gemius|doubleclick|facebook\.net/i.test(respUrl)) return;

          const data = await response.json();

          // Log ALL JSON responses so we can identify the right one
          const topKeys = typeof data === 'object' && data !== null
            ? Object.keys(data as object).slice(0, 6).join(', ')
            : typeof data;
          this.log(`JSON response: ${respUrl} | keys: [${topKeys}]`);

          const candidates = this.extractCandidates(data);
          if (candidates.length > 0) {
            const sample = candidates[0] as Record<string, unknown>;
            const sampleKeys = Object.keys(sample).slice(0, 5).join(', ');
            this.log(`  → ${candidates.length} listing-like items, first item keys: [${sampleKeys}]`);
            interceptedResponses.push({ respUrl, items: candidates });
          }
        } catch {
          // Body already consumed or not valid JSON — skip silently
        }
      };

      page.on('response', onResponse);

      try {
        // Navigate to homepage — direct search URL params don't work on Sbazar
        await page.goto(url, { timeout: this.config.timeout, waitUntil: 'domcontentloaded' });

        // Dismiss GDPR consent banner before interacting with the page
        await this.dismissConsentBanner(page);

        // Find the search input and submit the query like a real user
        const searchSubmitted = await this.submitSearchForm(page, query, filters);
        if (!searchSubmitted) {
          this.log('Could not find or submit search form');
          return;
        }

        // Wait for the search results to load
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
          this.log('networkidle timeout after search — proceeding anyway');
        });

        // Extra buffer for any post-load API calls
        await page.waitForTimeout(2_000);

        // Log final URL and a sample of DOM links for debugging
        const finalUrl = page.url();
        this.log(`Final page URL: ${finalUrl}`);
        const domLinks = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]'))
            .map((a) => a.getAttribute('href') ?? '')
            .filter((h) => h.startsWith('/') || h.includes('sbazar'))
            .slice(0, 15)
        ).catch(() => [] as string[]);
        this.log(`DOM links sample: ${domLinks.join(' | ')}`);

        if (interceptedResponses.length > 0) {
          // Prefer the response whose URL contains the search query — that's
          // the search-specific call, not homepage/featured content.
          const queryVariants = [
            query.toLowerCase(),
            encodeURIComponent(query).toLowerCase(),
            query.toLowerCase().replace(/\s+/g, '+'),
          ];
          const best =
            interceptedResponses.find((r) =>
              queryVariants.some((v) => r.respUrl.toLowerCase().includes(v)),
            ) ??
            // Fall back to whichever response has the most items
            interceptedResponses.sort((a, b) => b.items.length - a.items.length)[0];

          this.log(`Using API response from: ${best.respUrl} (${best.items.length} items)`);
          for (const raw of best.items) {
            const listing = this.normalizeApiItem(raw as Record<string, unknown>);
            if (listing) results.push(listing);
          }
          return;
        }

        this.log('No API response intercepted — falling back to DOM scraping');
      } finally {
        page.off('response', onResponse);
      }

      // ── Strategy 2: DOM anchor on listing links ─────────────────────────────
      // Try several known Sbazar URL patterns — /inzerat/ is historic but they
      // may have migrated to a different slug pattern. We try all of them.
      const LISTING_LINK_SELECTORS = [
        'a[href*="/inzerat/"]',
        'a[href*="/detail/"]',
        'a[href*="/nabidka/"]',
        'a[href*="/item/"]',
      ].join(', ');

      const domFound = await page
        .waitForSelector(LISTING_LINK_SELECTORS, { timeout: 12_000 })
        .catch(() => null);

      if (!domFound) {
        // Last-resort diagnostic: log page title and first 500 chars of body
        const title = await page.title().catch(() => '(unknown)');
        const bodyText = await page.evaluate(() =>
          document.body?.innerText?.slice(0, 300) ?? ''
        ).catch(() => '');
        this.log(`No listing links found. Page title: "${title}"`);
        this.log(`Body preview: ${bodyText}`);
        return;
      }

      const rawItems = await page.evaluate(() => {
        const seen = new Set<string>();
        const items: Array<Record<string, unknown>> = [];

        // All unique listing links — try every known Sbazar URL pattern
        const links = document.querySelectorAll(
          'a[href*="/inzerat/"], a[href*="/detail/"], a[href*="/nabidka/"], a[href*="/item/"]'
        );

        links.forEach((link) => {
          const href = link.getAttribute('href');
          if (!href || seen.has(href)) return;
          seen.add(href);

          // Walk up to find the card container
          const card =
            link.closest('article') ??
            link.closest('li') ??
            link.closest('[class*="item"]') ??
            link.closest('[class*="card"]') ??
            link.parentElement;

          // Title: the link text, or a heading inside the card
          const title =
            link.textContent?.trim() ||
            card?.querySelector('h2, h3, h4, [class*="title"], [class*="name"]')?.textContent?.trim() ||
            null;

          if (!title) return;

          // Price: any element containing "Kč"
          let priceText: string | null = null;
          if (card) {
            const els = Array.from(card.querySelectorAll('*'));
            for (const el of els) {
              const t = el.textContent?.trim() ?? '';
              if (/\d/.test(t) && /kč/i.test(t) && t.length < 30) {
                priceText = t;
                break;
              }
            }
            if (!priceText) {
              priceText = card.querySelector('[class*="price"]')?.textContent?.trim() ?? null;
            }
          }

          // Location
          const locationEl =
            card?.querySelector('[class*="location"], [class*="locality"], [class*="city"]');
          const location = locationEl?.textContent?.trim() ?? null;

          // Date
          const dateEl = card?.querySelector('time, [class*="date"], [class*="time"]');
          const dateText =
            dateEl?.getAttribute('datetime') ?? dateEl?.textContent?.trim() ?? null;

          // Image
          const imgEl = card?.querySelector('img');
          const imageUrl =
            imgEl?.getAttribute('src') ?? imgEl?.getAttribute('data-src') ?? null;

          // Seller name
          const sellerEl = card?.querySelector('[class*="seller"], [class*="user"], [class*="author"]');
          const sellerName = sellerEl?.textContent?.trim() ?? null;

          // Promoted
          const cardText = card?.textContent ?? '';
          const isPromoted =
            card?.classList.contains('c-item--top') ||
            card?.hasAttribute('data-top') ||
            /topov/i.test(cardText) ||
            !!card?.querySelector('[class*="top"], [class*="promoted"], [class*="boost"]');

          items.push({ href, title, priceText, location, dateText, imageUrl, sellerName, isPromoted });
        });

        return items;
      });

      this.log(`DOM anchor found ${rawItems.length} items`);

      for (const raw of rawItems) {
        const href = raw.href as string;
        const listingId = this.extractListingId(href);
        if (!listingId) continue;

        const price = this.safePrice(raw.priceText as string | null);
        const conditionText = this.inferConditionFromTitle(raw.title as string);

        results.push({
          id: this.makeId(listingId),
          source: 'sbazar',
          sourceListingId: listingId,
          url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
          title: raw.title as string,
          description: null,
          price,
          currency: 'CZK',
          location: (raw.location as string | null) ?? null,
          postedAt: this.parseCzechRelativeDate(raw.dateText as string | null),
          conditionText,
          condition: this.inferCondition(conditionText),
          imageCount: raw.imageUrl ? 1 : 0,
          imageUrl: this.resolveImageUrl(raw.imageUrl as string | null),
          sellerName: (raw.sellerName as string | null) ?? null,
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

  // ─── Search form submission ─────────────────────────────────────────────────

  private async submitSearchForm(
    page: Page,
    query: string,
    filters?: SearchFilters,
  ): Promise<boolean> {
    try {
      // Find the search input — try several common selectors
      const inputSelector = [
        'input[name="q"]',
        'input[name="query"]',
        'input[name="hledej"]',
        'input[type="search"]',
        'input[placeholder*="Hledej"]',
        'input[placeholder*="hledej"]',
        'input[placeholder*="Co hledáte"]',
        'input[placeholder*="Hledat"]',
      ].join(', ');

      const input = await page.waitForSelector(inputSelector, { timeout: 8_000 });
      if (!input) {
        this.log('Search input not found');
        return false;
      }

      // Clear and type query
      await input.click({ clickCount: 3 });
      await input.type(query, { delay: 40 });
      this.log(`Typed query: "${query}"`);

      // Submit — press Enter (works on all forms)
      await input.press('Enter');

      // Wait briefly for navigation to start
      await page.waitForTimeout(500);

      // Apply price filters via URL if the search landed on a results page
      const resultUrl = page.url();
      this.log(`Search landed on: ${resultUrl}`);

      if (filters?.priceMin != null || filters?.priceMax != null) {
        const parsed = new URL(resultUrl);
        if (filters.priceMin != null) parsed.searchParams.set('price_from', String(filters.priceMin));
        if (filters.priceMax != null) parsed.searchParams.set('price_to', String(filters.priceMax));
        await page.goto(parsed.toString(), { waitUntil: 'domcontentloaded' });
      }

      return true;
    } catch (err) {
      this.log(`Search form error: ${(err as Error).message}`);
      return false;
    }
  }

  // ─── Consent banner ────────────────────────────────────────────────────────

  private async dismissConsentBanner(page: Page): Promise<void> {
    try {
      // Seznam.cz / Sbazar uses the SZNC consent framework.
      // The "Accept all" button appears in several possible forms.
      const btn = await page.$(
        'button[data-consent-accept], ' +
        'button[class*="agree"], ' +
        'button[class*="accept"], ' +
        'button[id*="accept"], ' +
        'button:has-text("Přijmout vše"), ' +
        'button:has-text("Souhlasím"), ' +
        'button:has-text("Přijmout"), ' +
        '[data-testid="cmpAcceptAllBtn"]',
      );
      if (btn) {
        await btn.click();
        await page.waitForTimeout(1_000);
        this.log('Dismissed consent banner');
      }
    } catch {
      // Non-critical — continue without dismissing
    }
  }

  // ─── API interception helpers ───────────────────────────────────────────────

  /**
   * Try to extract an array of listing-like objects from a JSON payload.
   * Handles both {"ads": [...]} / {"items": [...]} wrapper shapes and bare arrays.
   * A "listing" is any object that has an id AND (name or title).
   */
  private extractCandidates(data: unknown): unknown[] {
    if (!data || typeof data !== 'object') return [];

    // Bare array
    if (Array.isArray(data)) {
      return this.filterListingLike(data);
    }

    // Wrapped object — try common keys
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

  /**
   * Normalize a raw API item to NormalizedListing.
   * Field names are guessed based on common Czech marketplace API conventions.
   */
  private normalizeApiItem(raw: Record<string, unknown>): NormalizedListing | null {
    const title = (raw.name ?? raw.title ?? raw.subject) as string | undefined;
    if (!title) return null;

    // URL
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

    // Price
    const priceObj = raw.price as Record<string, unknown> | undefined;
    const priceVal = priceObj?.amount ?? priceObj?.value ?? raw.price ?? raw.priceValue;
    const price = typeof priceVal === 'number'
      ? priceVal
      : this.safePrice(String(priceVal ?? ''));

    // Location
    const locObj = (raw.locality ?? raw.location) as Record<string, unknown> | string | undefined;
    const location = typeof locObj === 'string'
      ? locObj
      : (locObj?.name ?? locObj?.city ?? locObj?.district) as string | undefined ?? null;

    // Date
    const dateRaw = (raw.date ?? raw.createdAt ?? raw.datePosted ?? raw.insertTime) as string | undefined;
    const postedAt = dateRaw ? (this.safeDate(dateRaw) ?? this.parseCzechRelativeDate(dateRaw)) : null;

    // Image
    const imgs = raw.images as unknown[] | undefined;
    const firstImg = (Array.isArray(imgs) ? imgs[0] : undefined) as Record<string, unknown> | string | undefined;
    const imageUrl = typeof firstImg === 'string'
      ? firstImg
      : (firstImg?.url ?? firstImg?.src ?? firstImg?.thumb) as string | undefined ?? null;

    // Promoted
    const promoted = !!(raw.top ?? raw.promoted ?? raw.isTop ?? raw.boosted);

    // Condition
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
      imageUrl: this.resolveImageUrl(imageUrl ?? null),
      sellerName: ((raw.seller as Record<string, unknown>)?.name ?? raw.sellerName) as string | null ?? null,
      sellerRating: null,
      sellerReviewCount: null,
      views: (raw.views ?? raw.viewCount) as number | null ?? null,
      likes: null,
      shippingAvailable: null,
      promoted,
      rawMetadata: raw,
    };
  }

  // ─── Shared helpers ─────────────────────────────────────────────────────────

  private extractListingId(href: string): string | null {
    // Known patterns:
    //   /inzerat/12345678-iphone-13
    //   /detail/12345678-slug
    //   /nabidka/12345678
    const match = href.match(/\/(?:inzerat|detail|nabidka|item)\/(\d+)/);
    if (match) return match[1];
    // Fallback: any leading numeric segment in the path
    const numeric = href.match(/\/(\d{5,})/);
    return numeric?.[1] ?? null;
  }

  private resolveImageUrl(src: string | null): string | null {
    if (!src) return null;
    if (src.startsWith('http')) return src;
    if (src.startsWith('//')) return `https:${src}`;
    return `${BASE_URL}${src}`;
  }

  /**
   * Scan title text for Czech condition keywords.
   * Consistent with BazosAdapter so normalizeCondition() maps them the same way.
   */
  private inferConditionFromTitle(text: string): string | null {
    if (!text) return null;
    const lower = text.toLowerCase();

    // New
    if (/v záruční době|v záruce|záruční|zapečetěný|zapečetěná/.test(lower)) return 'v záruce';
    if (/nerozbalený|nerozbalená|nerozbalené|sealed|boxed/.test(lower)) return 'nerozbalený';
    if (/\bnový\b|\bnová\b|\bnové\b|nepoužitý|nepoužitá|nepoužité|\bnew\b|brand new/.test(lower)) return 'nový';

    // Like new
    if (/jako nový|jako nová|jako nové|stav jako nový/.test(lower)) return 'jako nový';
    if (/zánovní|zánovni/.test(lower)) return 'zánovní';
    if (/téměř nový|téměř nová|skoro nový|skoro nová/.test(lower)) return 'téměř nový';
    if (/bezvadný stav|bezvadný|skvělý stav|top stav/.test(lower)) return 'výborný stav';
    if (/výborný stav|perfektní stav|perfektní kondice|výborná kondice/.test(lower)) return 'výborný stav';
    if (/\bperfektní\b|\bvýborný\b|\bvýborná\b/.test(lower)) return 'výborný stav';
    if (/\bmint\b|mint condition|lightly used|barely used/.test(lower)) return 'jako nový';

    // Good
    if (/plně funkční|funkční stav|bez závad|bez problémů|bez vad/.test(lower)) return 'dobrý stav';
    if (/hezký stav|pěkný stav|zachovalý stav/.test(lower)) return 'dobrý stav';
    if (/dobrý stav|dobrá kondice/.test(lower)) return 'dobrý stav';
    if (/zachovalý|zachovalá|zachovalé/.test(lower)) return 'dobrý stav';
    if (/\bfunkční\b/.test(lower)) return 'dobrý stav';

    // Fair
    if (/drobné škrábance|drobné poškrábání|lehce poškrábané|stopy použití|stopy opotřebení/.test(lower)) return 'drobné škrábance';
    if (/kosmetické vady|kosmetická vada|viditelné opotřebení/.test(lower)) return 'drobné škrábance';
    if (/lehce poškozený|lehce poškozená|lehce opotřebovaný/.test(lower)) return 'drobné škrábance';
    if (/opotřebovaný|opotřebovaná|opotřebované/.test(lower)) return 'opotřebovaný';

    // Poor
    if (/na díly|na náhradní díly|ke opravě|potřebuje opravu|potřebuje servis/.test(lower)) return 'na díly';
    if (/nefunkční displej|rozbitý displej|prasklý displej|popraskané sklo|rozbité sklo/.test(lower)) return 'poškozený';
    if (/poškozený|poškozená|poškozené/.test(lower)) return 'poškozený';
    if (/nefunkční|rozbité|rozbitý|rozbitá|prasklé|prasklý/.test(lower)) return 'nefunkční';

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
