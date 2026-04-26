import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSearchCacheKey } from '@sdf/core';
import type { Source } from '@sdf/types';
import {
  checkRateLimit,
  createAustriaSearchCoordinator,
  enqueueSearchJob,
  getSearchCache,
  getSearchJobResult,
  getSearchJobState,
  isWorkerSearchEnabled,
} from '@sdf/platform';

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

const searchCache = getSearchCache();
const inlineCoordinator = createAustriaSearchCoordinator({ cache: searchCache });

function clientIdentifier(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'anonymous'
  );
}

async function waitForJobResult(jobId: string, timeoutMs: number): Promise<Awaited<ReturnType<typeof getSearchJobResult>>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await getSearchJobResult(jobId);
    if (result) return result;

    const state = await getSearchJobState(jobId);
    if (state?.status === 'failed') {
      throw new Error(state.error ?? 'Worker search failed');
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = SearchSchema.safeParse(params);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Ungültige Anfrage', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { query, priceMin, priceMax, location, locationRadius, sources, sortBy, debug, limit } =
    parsed.data;

  try {
    const rateLimit = await checkRateLimit({
      namespace: 'search-at',
      identifier: clientIdentifier(req),
      limit: Number(process.env.SEARCH_RATE_LIMIT ?? 20),
      windowMs: Number(process.env.SEARCH_RATE_WINDOW_MS ?? 60_000),
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfterMs: rateLimit.retryAfterMs },
        { status: 429 },
      );
    }

    const searchRequest = {
      query,
      filters: { priceMin, priceMax, location, locationRadius, sources, sortBy },
      debug,
      limit,
    };

    if (debug || !isWorkerSearchEnabled()) {
      const result = await inlineCoordinator.search(searchRequest);
      return NextResponse.json(result, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    const cached = await searchCache.get(createSearchCacheKey(searchRequest, 50, 100, 'at'));
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    const job = await enqueueSearchJob('at', searchRequest);
    if (!job) {
      const result = await inlineCoordinator.search(searchRequest);
      return NextResponse.json(result, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    const result = await waitForJobResult(
      job.jobId,
      Number(process.env.SEARCH_SYNC_WAIT_MS ?? 25_000),
    );

    if (!result) {
      const fallback = await inlineCoordinator.search(searchRequest);
      return NextResponse.json(fallback, {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
        },
      });
    }

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('[web-at/api/search] Unhandled error:', err);
    return NextResponse.json({ error: 'Suche fehlgeschlagen' }, { status: 500 });
  }
}
