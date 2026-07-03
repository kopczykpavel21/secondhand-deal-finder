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

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
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
    ...html.matchAll(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/gi),
    ...html.matchAll(/<script[^>]*>\s*window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/gi),
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

function parseTipCarsDate(raw: string | null): Date | null {
  if (!raw) return null;
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;

  const match = raw.match(/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  return new Date(Number(match[2]), Number(match[1]) - 1, 1);
}

function parseFuel(text: string | null): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('nafta')) return 'nafta';
  if (lower.includes('benzin') || lower.includes('benzin')) return 'benzin';
  if (lower.includes('hybrid')) return 'hybrid';
  if (lower.includes('elektro')) return 'elektro';
  if (lower.includes('lpg')) return 'lpg';
  if (lower.includes('cng')) return 'cng';
  return null;
}

function parseTransmission(text: string | null): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('automat')) return 'automat';
  if (lower.includes('manu')) return 'manuál';
  return null;
}

function stableFallbackId(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 16);
}

export class TipCarsAdapter extends BaseAdapter {
  source = 'tipcars' as const;
  supportLevel = 'experimental' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super({ timeout: 15_000, rateLimitMs: 1_000, retries: 1, ...config }, getMarketConfig('cz'));
  }

  buildSearchUrl(query: string, _filters?: SearchFilters): string {
    return `${BASE_URL}/${toSlug(query)}`;
  }

  async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    return this.withRetry(() => this.fetchListings(query, filters), 'tipcars.search');
  }

  private async fetchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
    const url = this.buildSearchUrl(query, filters);
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

    if (!response.ok) {
      throw new Error(`TipCars HTTP ${response.status}`);
    }

    const html = await response.text();
    const structured = this.parseStructured(html);
    if (structured.length > 0) {
      this.log(`Structured parse returned ${structured.length} listings`);
      return this.applyFilters(structured, filters);
    }

    const fallback = this.parseFallback(html);
    this.log(`Fallback parse returned ${fallback.length} listings`);
    return this.applyFilters(fallback, filters);
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
      const rawUrl = normalizeUrl(
        asString(obj.url) ??
        asString(obj.href) ??
        asString(obj.link)
      );
      const title = decodeEntities(asString(obj.name) ?? asString(obj.title) ?? '');
      if (!rawUrl || !title || !/tipcars\.com|^\/|^[a-z0-9-]+$/i.test(rawUrl)) continue;

      const listingId =
        asString(obj.id) ??
        this.extractListingId(rawUrl) ??
        stableFallbackId(rawUrl);
      if (seen.has(listingId)) continue;
      seen.add(listingId);

      const offers = (obj.offers as Record<string, unknown> | undefined) ?? {};
      const price =
        extractPrice(offers.price) ??
        extractPrice((offers.priceSpecification as Record<string, unknown> | undefined)?.price) ??
        extractPrice(obj.price);
      if (price == null) continue;

      const description = decodeEntities(asString(obj.description) ?? '') || null;
      const yearText =
        asString(obj.productionDate) ??
        asString(obj.vehicleModelDate) ??
        asString(obj.modelDate) ??
        asString(obj.dateVehicleFirstRegistered) ??
        null;
      const mileageText =
        asString(obj.mileageFromOdometer) ??
        asString(obj.mileage) ??
        asString(obj.distance) ??
        null;
      const fuelText =
        asString(obj.fuelType) ??
        asString(obj.fuel) ??
        null;
      const transmissionText =
        asString(obj.vehicleTransmission) ??
        asString(obj.transmission) ??
        null;
      const location =
        decodeEntities(
          asString((obj.address as Record<string, unknown> | undefined)?.addressLocality) ??
          asString(obj.location) ??
          asString(obj.sellerLocation) ??
          ''
        ) || null;
      const sellerName =
        decodeEntities(
          asString((obj.brand as Record<string, unknown> | undefined)?.name) ??
          asString((obj.seller as Record<string, unknown> | undefined)?.name) ??
          asString((obj.provider as Record<string, unknown> | undefined)?.name) ??
          asString(obj.sellerName) ??
          ''
        ) || null;

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
        postedAt: parseTipCarsDate(asString(obj.datePosted) ?? asString(obj.dateCreated) ?? yearText),
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
          mileageText,
          fuelText,
          transmissionText,
          bodyType: asString(obj.bodyType),
          powerText: asString(obj.vehicleEnginePower) ?? asString(obj.power),
        },
      });
    }

    return results;
  }

  private parseFallback(html: string): NormalizedListing[] {
    const results: NormalizedListing[] = [];
    const seen = new Set<string>();

    const blocks = html.split(/fotografie inzerátu/gi).slice(1);
    for (const block of blocks) {
      const snippet = block.slice(0, 3000);
      const titleMatch =
        snippet.match(/>\s*(Škoda|Skoda|Volkswagen|Ford|Hyundai|Toyota|BMW|Mercedes-Benz|Mercedes|Audi|Renault|Peugeot|Kia|Opel|Dacia)\s+([^<]{1,80})</i) ??
        snippet.match(/title="([^"]{4,120})"/i);
      const title = titleMatch
        ? stripTags(titleMatch[0].replace(/^>/, '').replace(/<$/, '')).replace(/\s{2,}/g, ' ')
        : null;
      if (!title) continue;

      const hrefMatch = snippet.match(/href="([^"]+)"/i);
      const rawUrl = normalizeUrl(hrefMatch?.[1] ?? null);
      if (!rawUrl) continue;

      const listingId = this.extractListingId(rawUrl) ?? stableFallbackId(rawUrl);
      if (seen.has(listingId)) continue;
      seen.add(listingId);

      const priceMatch = snippet.match(/###\s*([\d\s]+)\s*Kč/i);
      const price = extractPrice(priceMatch?.[1] ?? null);
      if (price == null) continue;

      const yearText = snippet.match(/\b(\d{1,2}\/\d{4}|\d{4})\b/)?.[1] ?? null;
      const mileageText = snippet.match(/(\d[\d\s]{2,})\s*km/i)?.[1] ?? null;
      const powerText = snippet.match(/(\d[\d\s]{1,3})\s*kW/i)?.[1] ?? null;
      const fuelText = snippet.match(/\b(nafta|benzin|hybrid|elektro|lpg|cng)\b/i)?.[1] ?? null;
      const transmissionText = snippet.match(/\b(automat|manuál|manual)\b/i)?.[1] ?? null;
      const sellerName = snippet.match(/\b([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][^<\n]{2,80})\s*$/m)?.[1] ?? null;
      const description = stripTags((snippet.match(/Kč[\s\S]{0,1200}/i)?.[0] ?? '').replace(/Kč/i, '')).trim() || null;

      results.push({
        id: this.makeId(listingId),
        source: 'tipcars',
        sourceListingId: listingId,
        url: rawUrl,
        title,
        description,
        price,
        currency: 'CZK',
        location: null,
        postedAt: parseTipCarsDate(yearText),
        conditionText: null,
        condition: this.inferCondition(null),
        imageCount: 1,
        imageUrl: null,
        sellerName,
        sellerRating: null,
        sellerReviewCount: null,
        views: null,
        likes: null,
        shippingAvailable: false,
        promoted: this.detectPromoted({ snippet }),
        rawMetadata: {
          yearText,
          mileageText,
          powerText,
          fuelText: parseFuel(fuelText),
          transmissionText: parseTransmission(transmissionText),
        },
      });
    }

    return results;
  }

  private extractListingId(url: string): string | null {
    const match =
      url.match(/\/([0-9]+)(?:\.html)?$/) ??
      url.match(/inzerat-([0-9]+)/i) ??
      url.match(/\/detail\/([0-9]+)/i);
    return match?.[1] ?? null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    const text = JSON.stringify(raw).toLowerCase();
    return text.includes('top nabídka') || text.includes('novinka');
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
