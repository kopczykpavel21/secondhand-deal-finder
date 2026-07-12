import { NextRequest } from 'next/server';
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
  readSearchJobEvents,
} from '@sdf/platform';

const SearchSchema = z.object({
  query: z.string().min(1).max(200),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
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
  limit: z.coerce.number().min(1).max(100).optional().default(50),
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

const encoder = new TextEncoder();

function sseChunk(data: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function responseToCompleteEvent(response: SearchResponse) {
  return {
    type: 'complete' as const,
    results: response.results,
    total: response.total,
    sources: response.sources,
    executionMs: response.executionMs,
  };
}

/**
 * Runs enrichment + price-history annotation on `complete` events before
 * they are sent; other event types pass through untouched. Best-effort —
 * a finalization failure must not kill the stream.
 */
async function finalizeEvent<T extends { type: string; results?: unknown[] }>(event: T): Promise<T> {
  if (event.type === 'complete' && Array.isArray(event.results)) {
    try {
      await finalizeSearchResults(event.results as Parameters<typeof finalizeSearchResults>[0]);
    } catch (err) {
      console.error('[api/search/stream] finalize failed:', err);
    }
  }
  return event;
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = SearchSchema.safeParse(params);

  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Neplatný požadavek' }), { status: 400 });
  }

  const { query, priceMin, priceMax, sources, sortBy, limit } = parsed.data;
  const searchRequest = {
    query,
    filters: { priceMin, priceMax, sources, sortBy },
    limit,
  };

  const rateLimit = await checkRateLimit({
    namespace: 'search-stream',
    identifier: clientIdentifier(req),
    limit: Number(process.env.SEARCH_STREAM_RATE_LIMIT ?? 10),
    windowMs: Number(process.env.SEARCH_STREAM_RATE_WINDOW_MS ?? 60_000),
  });

  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });
  }

  if (!isWorkerSearchEnabled()) {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of inlineCoordinator.searchStream(searchRequest)) {
            controller.enqueue(sseChunk(await finalizeEvent(event)));
          }
        } catch (err) {
          controller.enqueue(sseChunk({ type: 'error', message: (err as Error).message }));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  }

  const cached = await searchCache.get(createSearchCacheKey(searchRequest, 50, 100, 'cz'));
  if (cached) {
    return new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(sseChunk(await finalizeEvent(responseToCompleteEvent(cached))));
        controller.close();
      },
    }), { headers: SSE_HEADERS });
  }

  const job = await enqueueSearchJob('cz', searchRequest);
  if (!job) {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of inlineCoordinator.searchStream(searchRequest)) {
            controller.enqueue(sseChunk(await finalizeEvent(event)));
          }
        } catch (err) {
          controller.enqueue(sseChunk({ type: 'error', message: (err as Error).message }));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  }

  const stream = new ReadableStream({
    async start(controller) {
      let cursor = 0;
      const deadline = Date.now() + Number(process.env.SEARCH_STREAM_WAIT_MS ?? 65_000);
      try {
        while (Date.now() < deadline) {
          const events = await readSearchJobEvents(job.jobId, cursor);
          if (events.length > 0) {
            cursor += events.length;
            for (const event of events) {
              controller.enqueue(sseChunk(await finalizeEvent(event)));
              if (event.type === 'complete' || event.type === 'error') return;
            }
          }

          const result = await getSearchJobResult(job.jobId);
          if (result) {
            controller.enqueue(sseChunk(await finalizeEvent(responseToCompleteEvent(result))));
            return;
          }

          const state = await getSearchJobState(job.jobId);
          if (state?.status === 'failed') {
            controller.enqueue(sseChunk({ type: 'error', message: state.error ?? 'Vyhledávání selhalo' }));
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        controller.enqueue(sseChunk({ type: 'error', message: 'Vyhledávání vypršelo' }));
      } catch (err) {
        controller.enqueue(sseChunk({ type: 'error', message: (err as Error).message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
