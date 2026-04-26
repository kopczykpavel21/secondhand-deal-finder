import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SearchCoordinator } from '@sdf/core';
import { getMarketConfig } from '@sdf/types';
import type { Source } from '@sdf/types';
import {
  MockAdapter,
  VintedAdapter,
  OlxAdapter,
  AllegroLokalnieAdapter,
  SprzedajemyAdapter,
} from '@sdf/source-adapters';

// ─── Request schema ───────────────────────────────────────────────────────────

const SearchSchema = z.object({
  query: z.string().min(1).max(200),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
  location: z.string().optional(),
  locationRadius: z.coerce.number().optional(),
  sources: z
    .string()
    .optional()
    .transform((v) =>
      v ? (v.split(',') as Source[]) : undefined,
    ),
  sortBy: z
    .enum(['best_deal', 'newest', 'cheapest', 'safest', 'most_relevant'])
    .optional()
    .default('best_deal'),
  debug: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().min(1).max(50).optional().default(25),
});

// ─── Adapter factory ──────────────────────────────────────────────────────────

function buildAdapters() {
  const useMock = process.env.USE_MOCK_ADAPTERS === 'true';
  if (useMock) {
    return [new MockAdapter()];
  }

  const adapters = [];
  if (process.env.ENABLE_VINTED !== 'false') {
    adapters.push(new VintedAdapter({
      baseUrl: 'https://www.vinted.pl',
      marketConfig: getMarketConfig('pl'),
    }));
  }
  if (process.env.ENABLE_OLX !== 'false') {
    adapters.push(new OlxAdapter());
  }
  if (process.env.ENABLE_ALLEGRO_LOKALNIE !== 'false') {
    adapters.push(new AllegroLokalnieAdapter());
  }
  if (process.env.ENABLE_SPRZEDAJEMY !== 'false') {
    adapters.push(new SprzedajemyAdapter());
  }

  return adapters;
}

const coordinator = new SearchCoordinator(buildAdapters(), getMarketConfig('pl'));

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = SearchSchema.safeParse(params);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Nieprawidłowe żądanie', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { query, priceMin, priceMax, location, locationRadius, sources, sortBy, debug, limit } =
    parsed.data;

  try {
    const result = await coordinator.search({
      query,
      filters: { priceMin, priceMax, location, locationRadius, sources, sortBy },
      debug,
      limit,
    });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('[api/search] Unhandled error:', err);
    return NextResponse.json({ error: 'Wyszukiwanie nie powiodło się' }, { status: 500 });
  }
}
