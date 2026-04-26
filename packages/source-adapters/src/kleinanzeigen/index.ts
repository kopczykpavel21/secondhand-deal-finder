/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — Kleinanzeigen (kleinanzeigen.de)
 *  Strategy: plain fetch() + HTML parsing  (NO Playwright)
 *  Verified live: April 2026
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  How it works:
 *    1. GET /s-{query}/k0?minPrice=&maxPrice=  (spaces → +)
 *    2. Parse <article class="aditem" data-adid="..." data-href="...">
 *    3. Extract fields from child elements
 *
 *  HTML structure per listing:
 *    data-adid                    → sourceListingId
 *    data-href                    → relative URL
 *    <script type="application/ld+json"> → title, description, contentUrl (image)
 *    <h2 class="text-module-begin"> <a class="ellipsis">  → title (fallback)
 *    <p class="aditem-main--middle--description">         → description (fallback)
 *    <p class="aditem-main--middle--price-shipping--price"> → price (may include "VB")
 *    icon-pin-gray text in aditem-main--top--left         → location (ZIP + city)
 *    icon-calendar-open text in aditem-main--top--right   → date ("Heute, HH:MM" / "Gestern, HH:MM")
 *    parent <li class="... is-topad ...">                 → promoted flag
 *    <div class="galleryimage--counter">N</div>           → imageCount
 *    <div class="badge-hint-pro-small-srp">               → PRO seller badge
 *    seller name in .text-module-oneline > span           → sellerName (pro sellers only)
 *
 *  Extractable signals:
 *    ✅  Title, description, price (EUR), location, image URL
 *    ✅  Relative date (Heute / Gestern)
 *    ✅  Image count
 *    ✅  Promoted flag (is-topad)
 *    ✅  PRO seller name
 *    ❌  Exact post date for older listings (not shown in search results)
 *    ❌  Seller rating / review count (not in search results)
 *    ❌  Views / likes (not exposed)
 *
 *  Pagination:
 *    Page 1: /s-{query}/k0
 *    Page N: /s-seite:{N}/{query}/k0
 *    ~25–27 results per page; fetch 3 pages = up to ~81 results.
 *
 *  Price filter: ?minPrice={n}&maxPrice={n} query params
 *
 *  Support level: FULL
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.kleinanzeigen.de';
const RESULTS_PER_PAGE = 25;
const MAX_PAGES = 3;

// ─── HTML utilities ───────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/g, '');
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// ─── Block splitter ───────────────────────────────────────────────────────────

const ITEM_MARKER = 'class="ad-listitem';

function splitIntoItems(html: string): string[] {
  const items: string[] = [];
  let pos = 0;
  while (true) {
    const start = html.indexOf(ITEM_MARKER, pos);
    if (start === -1) break;
    const next = html.indexOf(ITEM_MARKER, start + ITEM_MARKER.length);
    const end = next === -1 ? html.length : next;
    items.push(html.slice(start, end));
    pos = start + ITEM_MARKER.length;
  }
  return items;
}

// ─── Per-item parsing ─────────────────────────────────────────────────────────

interface ParsedItem {
  adId: string | null;
  href: string | null;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  imageCount: number;
  priceText: string | null;
  location: string | null;
  dateText: string | null;
  sellerName: string | null;
  isPromoted: boolean;
}

function parseItem(block: string): ParsedItem {
  // Listing ID and relative href
  const adIdMatch = block.match(/data-adid="(\d+)"/);
  const adId = adIdMatch?.[1] ?? null;

  const hrefMatch = block.match(/data-href="([^"]+)"/);
  const href = hrefMatch?.[1] ?? null;

  // JSON-LD gives the cleanest title + description + image
  let title: string | null = null;
  let description: string | null = null;
  let imageUrl: string | null = null;

  const ldMatch = block.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ldMatch) {
    try {
      const ld = JSON.parse(ldMatch[1]) as Record<string, unknown>;
      title = typeof ld.title === 'string' ? ld.title : null;
      description = typeof ld.description === 'string' ? ld.description.slice(0, 400) : null;
      // contentUrl is the full-size image; use the $59.AUTO variant for display
      imageUrl = typeof ld.contentUrl === 'string' ? ld.contentUrl : null;
    } catch { /* ignore */ }
  }

  // Fallback title from <a class="ellipsis">
  if (!title) {
    const titleMatch = block.match(/class="ellipsis"[^>]*>([\s\S]*?)<\/a>/);
    title = titleMatch ? stripTags(titleMatch[1]) : null;
  }

  // Fallback description from <p class="aditem-main--middle--description">
  if (!description) {
    const descMatch = block.match(/class="aditem-main--middle--description"[^>]*>([\s\S]*?)<\/p>/);
    description = descMatch ? stripTags(descMatch[1]) : null;
  }

  // Price: <p class="aditem-main--middle--price-shipping--price">99 €</p>
  const priceMatch = block.match(/class="aditem-main--middle--price-shipping--price"[^>]*>([\s\S]*?)<\/p>/);
  const priceText = priceMatch ? stripTags(priceMatch[1]) : null;

  // Location: text after icon-pin-gray in aditem-main--top--left
  const locMatch = block.match(/icon-pin-gray[^>]*><\/i>\s*([^\n<]+)/);
  const location = locMatch ? locMatch[1].trim() : null;

  // Date: "Heute, HH:MM" or "Gestern, HH:MM" in aditem-main--top--right
  const dateMatch = block.match(/icon-calendar-open[^>]*><\/i>\s*([^\n<]+)/);
  const dateText = dateMatch ? dateMatch[1].trim() : null;

  // Image count from gallery counter
  const galleryMatch = block.match(/class="galleryimage--counter">\s*(\d+)\s*<\/div>/);
  const imageCount = galleryMatch ? parseInt(galleryMatch[1], 10) : (imageUrl ? 1 : 0);

  // Seller name (PRO sellers only): in .text-module-oneline > a > span
  const sellerMatch = block.match(/badge-hint-pro-small-srp[\s\S]*?<span>([^<]+)<\/span>/);
  const sellerName = sellerMatch ? sellerMatch[1].trim() : null;

  // Promoted: parent li has is-topad class
  const isPromoted = /\bis-topad\b/.test(block.slice(0, 200));

  return { adId, href, title, description, imageUrl, imageCount, priceText, location, dateText, sellerName, isPromoted };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class KleinanzeigeAdapter extends BaseAdapter {
  source = 'kleinanzeigen' as const;
  supportLevel = 'full' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_200, retries: 1, ...config });
  }

  buildSearchUrl(query: string, filters?: SearchFilters, page = 1): string {
    const slug = query.trim().replace(/\s+/g, '+');
    const base = page === 1
      ? `${BASE_URL}/s-${slug}/k0`
      : `${BASE_URL}/s-seite:${page}/${slug}/k0`;
    const params = new URLSearchParams();
    if (filters?.priceMin != null) params.set('minPrice', String(filters.priceMin));
    if (filters?.priceMax != null) params.set('maxPrice', String(filters.priceMax));
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this._fetch(query, filters), 'kleinanzeigen.search');
  }

  private async _fetch(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const results: NormalizedListing[] = [];
    const seenIds = new Set<string>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = this.buildSearchUrl(query, filters, page);
      this.log(`Fetching page ${page}: ${url.slice(0, 80)}…`);

      let html: string;
      try {
        html = await this.fetchHtml(url);
      } catch (err) {
        this.log(`Page ${page} failed: ${(err as Error).message}`);
        break;
      }

      const items = splitIntoItems(html);
      this.log(`Page ${page}: ${items.length} items`);

      for (const block of items) {
        const parsed = parseItem(block);
        if (!parsed.adId || !parsed.title) continue;
        if (seenIds.has(parsed.adId)) continue;
        seenIds.add(parsed.adId);

        const listing = this.normalize(parsed);
        if (listing) results.push(listing);
      }

      if (items.length < RESULTS_PER_PAGE) break;
    }

    this.log(`Total unique results: ${results.length}`);
    return results;
  }

  private normalize(p: ParsedItem): NormalizedListing | null {
    if (!p.adId || !p.title || !p.href) return null;

    const price = this.parseKaPrice(p.priceText);
    const conditionText = this.inferConditionFromTitle(p.title) ?? this.inferConditionFromTitle(p.description ?? '');

    return {
      id: this.makeId(p.adId),
      source: 'kleinanzeigen',
      sourceListingId: p.adId,
      url: `${BASE_URL}${p.href}`,
      title: p.title,
      description: p.description,
      price,
      currency: 'EUR',
      location: p.location,
      postedAt: this.parseKaDate(p.dateText),
      conditionText,
      condition: this.inferCondition(conditionText),
      imageCount: p.imageCount,
      imageUrl: p.imageUrl,
      sellerName: p.sellerName,
      sellerRating: null,
      sellerReviewCount: null,
      views: null,
      likes: null,
      shippingAvailable: null,
      promoted: p.isPromoted,
      rawMetadata: { priceText: p.priceText, location: p.location, dateText: p.dateText },
    };
  }

  private async fetchHtml(url: string): Promise<string> {
    this.log(`Fetching: ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': this.config.userAgent,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(this.config.timeout),
    });
    if (!res.ok) throw new Error(`kleinanzeigen HTTP ${res.status} for ${url}`);
    return res.text();
  }

  private parseKaPrice(text: string | null): number | null {
    if (!text) return null;
    // "VB" alone = negotiable, no fixed price
    if (/^VB$/.test(text.trim())) return null;
    // Strip "VB", currency symbols, thousand separators
    const cleaned = text.replace(/VB/gi, '').replace(/[^\d,.]/g, '').replace('.', '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isFinite(n) && n > 0 ? n : null;
  }

  private parseKaDate(text: string | null): Date | null {
    if (!text) return null;
    const now = new Date();
    const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
    const h = timeMatch ? parseInt(timeMatch[1], 10) : 12;
    const m = timeMatch ? parseInt(timeMatch[2], 10) : 0;

    if (/heute/i.test(text)) {
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      return d;
    }
    if (/gestern/i.test(text)) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      d.setHours(h, m, 0, 0);
      return d;
    }
    // "DD.MM.YYYY" format (older listings sometimes show full date in detail pages)
    const dateMatch = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (dateMatch) {
      return new Date(+dateMatch[3], +dateMatch[2] - 1, +dateMatch[1], h, m);
    }
    return null;
  }

  private inferConditionFromTitle(text: string): string | null {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (/neu(?:wertig)?|unbenutzt|ungeöffnet|originalverpackt|ovp/.test(lower)) return 'Neu';
    if (/wie neu|nahezu neu|kaum benutzt|fast neu/.test(lower)) return 'Wie neu';
    if (/sehr gut(?:er)? zustand|top zustand|einwandfrei|makellos/.test(lower)) return 'Sehr gut';
    if (/gut(?:er)? zustand|guter zustand|gepflegt/.test(lower)) return 'Gut';
    if (/gebraucht|verwendet/.test(lower)) return 'Gebraucht';
    if (/bastler|defekt|kaputt|reparaturbedürftig/.test(lower)) return 'Defekt';
    return null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return raw.isPromoted === true;
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    return {
      sellerName: (raw.sellerName as string | null) ?? null,
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
