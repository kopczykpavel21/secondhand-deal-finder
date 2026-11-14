/**
 * Frozen search results for replaying the ranking pipeline.
 *
 * Each JSON file is the raw adapter output of one real search on the Czech
 * site (captured from /api/search?debug=true), trimmed to the fields scoring
 * reads. URLs, seller names, descriptions, images, locations and dates are
 * deliberately left out: nothing personal is committed, and with no dates the
 * freshness and engagement components are constant, so a replay gives the same
 * order whenever it runs.
 *
 * To add a query: capture the debug response, trim it the same way, drop the
 * file here and list it in FIXTURE_SLUGS.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Condition, NormalizedListing, Source } from '@sdf/types';

export const FIXTURE_SLUGS = [
  'iphone-13',
  'garmin-fenix-7',
  'playstation-5',
  'samsung-galaxy-s23',
  'macbook-air-m1',
  'skoda-octavia',
  'horske-kolo',
  'lego',
] as const;
export type FixtureSlug = (typeof FIXTURE_SLUGS)[number];

interface FixtureListing {
  id: string;
  source: Source;
  title: string;
  price: number | null;
  totalPrice?: number | null;
  currency: string;
  category: string | null;
  conditionText: string | null;
  condition: Condition;
  promoted: boolean;
  views: number | null;
  likes: number | null;
  imageCount: number;
  shippingAvailable: boolean | null;
}

export interface RankingFixture {
  query: string;
  capturedOn: string;
  listings: NormalizedListing[];
}

const here = dirname(fileURLToPath(import.meta.url));

export function loadRankingFixture(slug: FixtureSlug): RankingFixture {
  const raw = JSON.parse(readFileSync(join(here, `${slug}.json`), 'utf8')) as {
    query: string;
    capturedOn: string;
    listings: FixtureListing[];
  };
  return {
    query: raw.query,
    capturedOn: raw.capturedOn,
    listings: raw.listings.map((l) => ({
      ...l,
      sourceListingId: l.id.split(':')[1],
      url: `fixture://${l.id}`,
      description: null,
      location: null,
      postedAt: null,
      imageUrl: l.imageCount > 0 ? 'fixture://image' : null,
      sellerName: null,
      sellerRating: null,
      sellerReviewCount: null,
      rawMetadata: {},
    })),
  };
}
