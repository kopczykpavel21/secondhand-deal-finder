import { NextRequest } from 'next/server';
import { z } from 'zod';
import { SearchCoordinator } from '@sdf/core';
import type { SourceAdapter } from '@sdf/types';
import { BazosAdapter, SbazarAdapter, VintedAdapter, FacebookAdapter, AukroAdapter, MockAdapter } from '@sdf/source-adapters';

const SearchSchema = z.object({
  query: z.string().min(1).max(200),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
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
  limit: z.coerce.number().min(1).max(100).optional().default(50),
});

function buildAdapters(): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') return [new MockAdapter()];
  const adapters: SourceAdapter[] = [new BazosAdapter()];
  if (process.env.ENABLE_SBAZAR !== 'false') adapters.push(new SbazarAdapter());
  if (process.env.ENABLE_VINTED === 'true') adapters.push(new VintedAdapter());
  if (process.env.ENABLE_FACEBOOK === 'true') adapters.push(new FacebookAdapter());
  if (process.env.ENABLE_AUKRO === 'true') adapters.push(new AukroAdapter());
  return adapters;
}

const coordinator = new SearchCoordinator(buildAdapters());
const encoder = new TextEncoder();

function sseChunk(data: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = SearchSchema.safeParse(params);

  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
  }

  const { query, priceMin, priceMax, sources, sortBy, limit } = parsed.data;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of coordinator.searchStream({
          query,
          filters: { priceMin, priceMax, sources, sortBy },
          limit,
        })) {
          controller.enqueue(sseChunk(event));
        }
      } catch (err) {
        controller.enqueue(sseChunk({ type: 'error', message: (err as Error).message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
