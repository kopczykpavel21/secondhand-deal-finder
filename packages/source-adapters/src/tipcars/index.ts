import { createHash } from 'crypto';
import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { getMarketConfig } from '@sdf/types';
import { BaseAdapter } from '../base-adapter.js';

const BASE_URL = 'https://www.tipcars.com';

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  const normalized = decodeEntities(value).replace(/\\\//g, '/').trim();
  if (normalized.startsWith('http')) return normalized;
  if (normalized.startsWith('/')) return `${BASE_URL}${normalized}`;
  return `${BASE_URL}/${normalized.replace(/^\/+/, '')}`;
}

function toSlug(value: string): string {
  return decodeEntities(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractStructuredObjects(html: string): Record<string, unknown>[] {
  const scripts = [
    ...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
  ];

  const out: Record<string, unknown>[] = [];

  function visit(value: unknown, depth = 0): void {
    if (depth > 7 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    out.push(record);
    for (const nested of Object.values(record)) visit(nested, depth + 1);
  }

  for (const script of scripts) {
    try {
      visit(JSON.parse(script[1]));
    } catch {
      // ignore malformed blocks
    }
  }

  return out;
}

function extractPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d,.]/g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstImage(value: unknown): string | null {
  if (typeof value === 'string') return normalizeUrl(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImage(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return normalizeUrl(
    asString(record.url) ??
    asString(record.src) ??
    asString(record.imageUrl) ??
    firstImage(record.thumbnail)
  );
}

function parseFuelFromPath(url: string): string | null {
  const match = url.match(/\/(benzin|nafta|diesel|hybrid|elektro|lpg|cng)\//i);
  if (!match) return null;
  const fuel = match[1].toLowerCase();
  return fuel === 'diesel' ? 'nafta' : fuel;
}

function stableFallbackId(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 16);
}

// Common model → brand slug prefixes, so a bare-model query ("octavia")
// still resolves to a valid TipCars listing page (/skoda-octavia).
const MODEL_BRANDS: Record<string, string> = {
  octavia: 'skoda', fabia: 'skoda', superb: 'skoda', kodiaq: 'skoda',
  karoq: 'skoda', kamiq: 'skoda', scala: 'skoda', rapid: 'skoda',
  citigo: 'skoda', roomster: 'skoda', yeti: 'skoda', felicia: 'skoda',
  enyaq: 'skoda',
  golf: 'volkswagen', passat: 'volkswagen', polo: 'volkswagen',
  tiguan: 'volkswagen', touran: 'volkswagen', caddy: 'volkswagen',
  transporter: 'volkswagen', arteon: 'volkswagen', touareg: 'volkswagen',
  focus: 'ford', fiesta: 'ford', mondeo: 'ford', kuga: 'ford',
  astra: 'opel', corsa: 'opel', insignia: 'opel', zafira: 'opel',
  megane: 'renault', clio: 'renault', scenic: 'renault', kadjar: 'renault',
  civic: 'honda', accord: 'honda', 'cr-v': 'honda', crv: 'honda',
  corolla: 'toyota', yaris: 'toyota', rav4: 'toyota', avensis: 'toyota',
  i30: 'hyundai', tucson: 'hyundai', ceed: 'kia', sportage: 'kia',
  qashqai: 'nissan', duster: 'dacia', sandero: 'dacia', logan: 'dacia',
};

export class TipCarsAdapter extends BaseAdapter {
  source = 'tipcars' as const;
  supportLevel = 'experimental' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_000, retries: 1, ...config }, getMarketConfig('cz'));
  }

  buildSearchUrl(query: string, _filters?: SearchFilters): string {
    return `${BASE_URL}/${toSlug(query)}`;
  }

  /**
   * TipCars only serves listing pages at /{brand} or /{brand}-{model} slugs
   * (e.g. /skoda, /skoda-octavia). There is no public fulltext search URL, so
   * we try the full slugified query first, then progressively drop trailing
   * tokens ("skoda octavia 2015" → /skoda-octavia-2015 → /skoda-octavia →
   * /skoda). Non-car queries simply 404 on every candidate and yield [].
   */
  private candidateSlugs(query: string): string[] {
    const slug = toSlug(query);
    if (!slug) return [];
    const tokens = slug.split('-');
    const candidates: string[] = [];

    // Bare-model query ("octavia", "octavia 2015") → prepend the brand.
    const brand = MODEL_BRANDS[tokens[0]];
    if (brand && tokens[0] !== brand) {
      candidates.push(`${brand}-${tokens[0]}`);
    }

    candidates.push(slug);
    for (let n = tokens.length - 1; n >= 1; n--) {
      const candidate = tokens.slice(0, n).join('-');
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }
    return candidates.slice(0, 4);
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'tipcars.search');
  }

  private async fetchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    for (const slug of this.candidateSlugs(query)) {
      const url = `${BASE_URL}/${slug}`;
      this.log(`Fetching: ${url}`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      // Unknown slug (non-car query, model without brand…) — try the next candidate.
      if (response.status === 404) {
        this.log(`404 for slug "${slug}"`);
        continue;
      }

      if (!response.ok) {
        throw new Error(`TipCars HTTP ${response.status}`);
      }

      const html = await response.text();

      const structured = this.parseStructured(html);
      if (structured.length > 0) {
        this.log(`Structured parse returned ${structured.length} listings`);
        return this.applyFilters(structured, filters);
      }

      const cards = this.parseCards(html);
      this.log(`Card parse returned ${cards.length} listings`);
      if (cards.length > 0) {
        return this.applyFilters(cards, filters);
      }
      // 200 page with no cards (empty result page) — a shorter slug won't be
      // more specific to the query, so stop here.
      return [];
    }

    this.log('No matching TipCars slug for query — returning 0 listings');
    return [];
  }

  private applyFilters(listings: NormalizedListing[], filters?: SearchFilters): NormalizedListing[] {
    const { priceMin, priceMax } = filters ?? {};
    return listings.filter((listing) => {
      if (priceMin != null && listing.price != null && listing.price < priceMin) return false;
      if (priceMax != null && listing.price != null && listing.price > priceMax) return false;
      return true;
    });
  }

  private parseStructured(html: string): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    for (const obj of extractStructuredObjects(html)) {
      // Only vehicle/product/offer-ish objects carry listings; site chrome
      // (WebSite, Organization) has no price and is skipped below.
      const rawUrl = normalizeUrl(
        asString(obj.url) ??
        asString(obj.href) ??
        asString(obj.link)
      );
      const title = decodeEntities(asString(obj.name) ?? asString(obj.title) ?? '');
      if (!rawUrl || !title) continue;

      const offers = (obj.offers as Record<string, unknown> | undefined) ?? {};
      const price =
        extractPrice(offers.price) ??
        extractPrice((offers.priceSpecification as Record<string, unknown> | undefined)?.price) ??
        extractPrice(obj.price);
      if (price == null) continue;

      const listingId =
        asString(obj.id) ??
        this.extractListingId(rawUrl) ??
        stableFallbackId(rawUrl);
      if (seen.has(listingId)) continue;
      seen.add(listingId);

      const description = decodeEntities(asString(obj.description) ?? '') || null;
      const yearText =
        asString(obj.productionDate) ??
        asString(obj.vehicleModelDate) ??
        asString(obj.modelDate) ??
        asString(obj.dateVehicleFirstRegistered) ??
        null;
      const location =
        decodeEntities(
          asString((obj.address as Record<string, unknown> | undefined)?.addressLocality) ??
          asString(obj.location) ??
          ''
        ) || null;
      const sellerName =
        decodeEntities(
          asString((obj.seller as Record<string, unknown> | undefined)?.name) ??
          asString((obj.provider as Record<string, unknown> | undefined)?.name) ??
          asString(obj.sellerName) ??
          ''
        ) || null;

      const postedAtText = asString(obj.datePosted) ?? asString(obj.dateCreated);
      const postedAt = postedAtText ? this.safeDate(postedAtText) : null;

      results.push({
        id: this.makeId(listingId),
        source: 'tipcars',
        sourceListingId: listingId,
        url: rawUrl,
        title,
        description,
        price,
        currency: 'CZK',
        location,
        postedAt,
        conditionText: null,
        condition: this.inferCondition(null),
        imageCount: firstImage(obj.image) ? 1 : 0,
        imageUrl: firstImage(obj.image),
        sellerName,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: false,
        promoted: this.detectPromoted(obj),
        rawMetadata: {
          yearText,
          mileageText: asString(obj.mileageFromOdometer) ?? asString(obj.mileage),
          fuelText: asString(obj.fuelType) ?? asString(obj.fuel),
          transmissionText: asString(obj.vehicleTransmission) ?? asString(obj.transmission),
        },
      });
    }

    return results;
  }

  /**
   * Parses the server-rendered listing cards. Each card lives in a
   * `advertisement__row` container:
   *   <div class="advertisement__row">
   *     <picture>…<img src="https://g.tipcars.com/…" …></picture>
   *     <section class="advertisement-name">
   *       <section class="advertisement-name__title">
   *         <a href="/skoda-octavia/liftback/benzin/…-9803869.html"
   *            data-offer-listing-id-param="9803869"><h3>Škoda Octavia</h3></a>
   *         <p class="text-M">1.5 TSI Top selection</p>
   *       </section>
   *       <section class="advertisement-name__price">
   *         <h3 class="text-h3 highlighted"> 574 000 Kč </h3>
   *       </section>
   *     </section>
   *     …
   *   </div>
   * The name section is rendered twice (desktop + mobile) — dedupe by id.
   */
  private parseCards(html: string): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    const rows = html.split(/class="advertisement__row"/).slice(1);
    for (const row of rows) {
      const listingId =
        row.match(/data-offer-listing-id-param="(\d+)"/)?.[1] ??
        this.extractListingId(row.match(/href="([^"]+\.html)"/)?.[1] ?? '') ??
        null;
      if (!listingId || seen.has(listingId)) continue;

      const href = row.match(/href="([^"]+\.html)"/)?.[1] ?? null;
      const url = normalizeUrl(href);
      if (!url) continue;

      const titleMatch = row.match(/advertisement-name__title[\s\S]{0,600}?<h3>\s*([^<]+?)\s*<\/h3>/);
      const baseTitle = titleMatch ? decodeEntities(titleMatch[1]).trim() : null;
      if (!baseTitle) continue;

      const subtitle = decodeEntities(row.match(/<p class="text-M">([^<]*)<\/p>/)?.[1] ?? '').trim();
      const title = subtitle ? `${baseTitle} ${subtitle}` : baseTitle;

      const priceMatch = row.match(/text-h3 highlighted">\s*([\d\s ]+)\s*Kč/);
      const price = extractPrice(priceMatch?.[1] ?? null);
      if (price == null) continue;

      seen.add(listingId);

      const imageUrl = normalizeUrl(row.match(/<img[^>]+src="(https:\/\/g\.tipcars\.com[^"]+)"/)?.[1] ?? null);
      const yearText = row.match(/\b(\d{1,2}\/\d{4})\b/)?.[1] ?? null;
      const mileageText = row.match(/([\d][\d\s ]{2,})\s*km\b/i)?.[1]?.replace(/[\s ]/g, '') ?? null;
      const fuelText = href ? parseFuelFromPath(href) : null;

      const detailBits = [yearText, mileageText ? `${mileageText} km` : null, fuelText]
        .filter(Boolean)
        .join(', ');

      results.push({
        id: this.makeId(listingId),
        source: 'tipcars',
        sourceListingId: listingId,
        url,
        title,
        description: detailBits || null,
        price,
        currency: 'CZK',
        location: null,
        // yearText is the manufacture date, not the posting date — leave null.
        postedAt: null,
        conditionText: null,
        condition: this.inferCondition(null),
        imageCount: imageUrl ? 1 : 0,
        imageUrl,
        sellerName: null,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: false,
        promoted: this.detectPromoted({ snippet: row.slice(0, 2000) }),
        rawMetadata: {
          yearText,
          mileageText,
          fuelText,
        },
      });
    }

    return results;
  }

  private extractListingId(url: string): string | null {
    const match =
      url.match(/-([0-9]+)\.html/) ??
      url.match(/\/([0-9]+)(?:\.html)?$/) ??
      url.match(/inzerat-([0-9]+)/i) ??
      url.match(/\/detail\/([0-9]+)/i);
    return match?.[1] ?? null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    const text = JSON.stringify(raw).toLowerCase();
    return text.includes('top nabídka') || text.includes('topovan');
  }

  extractSellerSignals(raw: Record<string, unknown>) {
    return {
      sellerName:
        asString((raw.seller as Record<string, unknown> | undefined)?.name) ??
        asString((raw.provider as Record<string, unknown> | undefined)?.name) ??
        asString(raw.sellerName) ??
        null,
      sellerRating: null,
      sellerReviewCount: null,
    };
  }
}
