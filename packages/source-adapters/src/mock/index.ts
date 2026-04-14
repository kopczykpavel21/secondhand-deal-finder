/**
 * Mock adapter — used in development and testing.
 * Returns realistic-looking fixtures without any network calls.
 * Support level: FULL (it always works)
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const MOCK_LISTINGS: Omit<NormalizedListing, 'id'>[] = [
  {
    source: 'bazos',
    sourceListingId: 'mock-001',
    url: 'https://www.bazos.cz/inzerat/mock-001',
    title: 'iPhone 13 128GB Space Gray – výborný stav',
    description: 'Prodávám iPhone 13 128GB, barva Space Gray. Výborný stav, minimální škrábance. Kompletní příslušenství.',
    price: 8900,
    currency: 'CZK',
    location: 'Praha 2',
    postedAt: new Date(Date.now() - 2 * 86_400_000),
    conditionText: 'Výborný stav',
    condition: 'like_new',
    imageCount: 3,
    imageUrl: 'https://picsum.photos/seed/mock001/400/300',
    sellerName: null,
    sellerRating: null,
    sellerReviewCount: null,
    views: null,
    likes: null,
    shippingAvailable: null,
    promoted: false,
    rawMetadata: {},
  },
  {
    source: 'sbazar',
    sourceListingId: 'mock-002',
    url: 'https://www.sbazar.cz/inzerat/mock-002',
    title: 'iPhone 13 128GB – nový, nerozbalený',
    description: 'Nový nerozbalený iPhone 13 128GB midnight. Zakoupený v CZC, záruka 24 měsíců.',
    price: 11500,
    currency: 'CZK',
    location: 'Brno',
    postedAt: new Date(Date.now() - 5 * 3_600_000),
    conditionText: 'Nový',
    condition: 'new',
    imageCount: 2,
    imageUrl: 'https://picsum.photos/seed/mock002/400/300',
    sellerName: 'martin_b',
    sellerRating: null,
    sellerReviewCount: null,
    views: null,
    likes: null,
    shippingAvailable: null,
    promoted: false,
    rawMetadata: {},
  },
  {
    source: 'vinted',
    sourceListingId: 'mock-003',
    url: 'https://www.vinted.cz/items/mock-003',
    title: 'iPhone 13 128GB modrý',
    description: null,
    price: 7200,
    currency: 'CZK',
    location: null,
    postedAt: new Date(Date.now() - 1 * 86_400_000),
    conditionText: null,
    condition: 'unknown',
    imageCount: 1,
    imageUrl: 'https://picsum.photos/seed/mock003/400/300',
    sellerName: 'jana_k',
    sellerRating: null,
    sellerReviewCount: null,
    views: null,
    likes: null,
    shippingAvailable: true,
    promoted: false,
    rawMetadata: {},
  },
  {
    source: 'bazos',
    sourceListingId: 'mock-004',
    url: 'https://www.bazos.cz/inzerat/mock-004',
    title: 'PRODÁM iPhone 13 – TOPOVANÝ INZERÁT tel. 777123456',
    description: 'Prodám iPhone, volejte na tel. 777123456.',
    price: 9999,
    currency: 'CZK',
    location: 'Ostrava',
    postedAt: new Date(Date.now() - 30 * 86_400_000),
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
    promoted: true,   // Topovaný inzerát
    rawMetadata: {},
  },
  {
    source: 'sbazar',
    sourceListingId: 'mock-005',
    url: 'https://www.sbazar.cz/inzerat/mock-005',
    title: 'iPhone 13 128GB – poškozený displej, na díly',
    description: 'Prasklý displej, jinak funkční. Vhodné na díly nebo opravu.',
    price: 3500,
    currency: 'CZK',
    location: 'Plzeň',
    postedAt: new Date(Date.now() - 7 * 86_400_000),
    conditionText: 'Poškozený',
    condition: 'poor',
    imageCount: 4,
    imageUrl: 'https://picsum.photos/seed/mock005/400/300',
    sellerName: 'tech_repair',
    sellerRating: null,
    sellerReviewCount: null,
    views: null,
    likes: null,
    shippingAvailable: null,
    promoted: false,
    rawMetadata: {},
  },
  {
    source: 'facebook',
    sourceListingId: 'mock-006',
    url: 'https://www.facebook.com/marketplace/item/mock-006',
    title: 'iPhone 13 128GB – dobrý stav',
    description: null,
    price: 8500,
    currency: 'CZK',
    location: null,
    postedAt: new Date(Date.now() - 3 * 86_400_000),
    conditionText: null,
    condition: 'good',
    imageCount: 1,
    imageUrl: 'https://picsum.photos/seed/mock006/400/300',
    sellerName: null,
    sellerRating: null,
    sellerReviewCount: null,
    views: null,
    likes: null,
    shippingAvailable: null,
    promoted: false,
    rawMetadata: {},
  },
];

export class MockAdapter extends BaseAdapter {
  source = 'mock' as const;
  supportLevel = 'full' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super(config);
  }

  /** Real search URLs so demo links actually open the correct site */
  private realUrl(source: NormalizedListing['source'], query: string): string {
    const q = encodeURIComponent(query);
    switch (source) {
      case 'bazos':    return `https://www.bazos.cz/search.php?hledat=${q}&Submit=Hledat&kitx=ano`;
      case 'sbazar':   return `https://www.sbazar.cz/hledej?q=${q}`;
      case 'vinted':   return `https://www.vinted.cz/catalog?search_text=${q}`;
      case 'facebook': return `https://www.facebook.com/marketplace/search/?query=${q}`;
      default:         return `https://www.bazos.cz/search.php?hledat=${q}`;
    }
  }

  async searchListings(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    const queryLower = query.toLowerCase();

    let results = MOCK_LISTINGS.map((l) => ({
      ...l,
      id: this.makeId(l.sourceListingId),
      // Point every mock listing at a real search page for this query
      url: this.realUrl(l.source, query),
    })).filter((l) => l.title.toLowerCase().includes(queryLower));

    if (filters?.priceMin != null) {
      results = results.filter((l) => l.price !== null && l.price >= filters.priceMin!);
    }
    if (filters?.priceMax != null) {
      results = results.filter((l) => l.price !== null && l.price <= filters.priceMax!);
    }
    if (filters?.sources && filters.sources.length > 0) {
      results = results.filter((l) => filters.sources!.includes(l.source));
    }

    return results;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return raw.promoted === true;
  }

  extractSellerSignals(_raw: Record<string, unknown>) {
    return { sellerName: null, sellerRating: null, sellerReviewCount: null };
  }
}
