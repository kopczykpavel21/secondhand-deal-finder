import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SearchCoordinator } from '@sdf/core';
import { MockAdapter } from '@sdf/source-adapters';
import { BazosAdapter } from '@sdf/source-adapters';
import { SbazarAdapter } from '@sdf/source-adapters';
import { VintedAdapter } from '@sdf/source-adapters';
import { FacebookAdapter } from '@sdf/source-adapters';
import { AukroAdapter } from '@sdf/source-adapters';

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
      v ? (v.split(',') as ('bazos' | 'sbazar' | 'vinted' | 'facebook' | 'aukro' | 'mock')[]) : undefined,
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

  // Always try Bazoš (most reliable)
  adapters.push(new BazosAdapter());

  // Sbazar — partial support
  if (process.env.ENABLE_SBAZAR !== 'false') {
    adapters.push(new SbazarAdapter());
  }

  // Vinted — experimental
  if (process.env.ENABLE_VINTED === 'true') {
    adapters.push(new VintedAdapter());
  }

  // Facebook — experimental (likely returns 0 results without auth)
  if (process.env.ENABLE_FACEBOOK === 'true') {
    adapters.push(new FacebookAdapter());
  }

  // Aukro — experimental, buy-now listings only; first source with seller ratings
  if (process.env.ENABLE_AUKRO === 'true') {
    adapters.push(new AukroAdapter());
  }

  return adapters;
}

const coordinator = new SearchCoordinator(buildAdapters());

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = SearchSchema.safeParse(params);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.flatten() },
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
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
