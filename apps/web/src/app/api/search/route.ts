import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSearchCacheKey } from '@sdf/core';
import type { SearchResponse, Source } from '@sdf/types';
import {
  checkRateLimit,
  createCzechSearchCoordinator,
  enqueueSearchJob,
  finalizeSearchResults,
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
    .enum(['best_deal', 'newest', 'cheapest', 'priciest', 'safest', 'most_relevant'])
    .optional()
    .default('best_deal'),
  debug: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().min(1).max(50).optional().default(25),
});

const searchCache = getSearchCache();
const inlineCoordinator = createCzechSearchCoordinator({ cache: searchCache });

function clientIdentifier(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'anonymous'
  );
}

/** Enrich + price-history-annotate results, then wrap in a JSON response. */
async function respondWithResults(
  result: SearchResponse,
  sMaxAge = 60,
  staleWhileRevalidate = 300,
): Promise<NextResponse> {
  try {
    await finalizeSearchResults(result.results);
  } catch (err) {
    console.error('[api/search] finalize failed:', err);
  }
  return NextResponse.json(result, {
    headers: {
      'Cache-Control': `public, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
    },
  });
}

async function waitForJobResult(jobId: string, timeoutMs: number): Promise<Awaited<ReturnType<typeof getSearchJobResult>>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await getSearchJobResult(jobId);
    if (result) return result;

    const state = await getSearchJobState(jobId);
    if (state?.status === 'failed') {
      throw new Error(state.error ?? 'Vyhledávání selhalo');
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
      { error: 'Neplatný požadavek', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { query, priceMin, priceMax, location, locationRadius, sources, sortBy, debug, limit } =
    parsed.data;

  try {
    const rateLimit = await checkRateLimit({
      namespace: 'search',
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
      return respondWithResults(result);
    }

    const cached = await searchCache.get(createSearchCacheKey(searchRequest, 50, 100, 'cz'));
    if (cached) {
      return respondWithResults(cached);
    }

    const job = await enqueueSearchJob('cz', searchRequest);
    if (!job) {
      const result = await inlineCoordinator.search(searchRequest);
      return respondWithResults(result);
    }

    const result = await waitForJobResult(
      job.jobId,
      Number(process.env.SEARCH_SYNC_WAIT_MS ?? 25_000),
    );

    if (!result) {
      const fallback = await inlineCoordinator.search(searchRequest);
      return respondWithResults(fallback, 30, 120);
    }

    return respondWithResults(result);
  } catch (err) {
    console.error('[api/search] Unhandled error:', err);
    return NextResponse.json({ error: 'Vyhledávání selhalo' }, { status: 500 });
  }
}
