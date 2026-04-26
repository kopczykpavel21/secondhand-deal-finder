import type {
  NormalizedListing,
  SearchFilters,
  Source,
  SourceAdapter,
  SourceSupportLevel,
} from '@sdf/types';

class Semaphore {
  private available: number;
  private queue: Array<() => void> = [];

  constructor(max: number) {
    this.available = max;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }

    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const waiter = this.queue.shift();
    if (waiter) {
      waiter();
      return;
    }
    this.available += 1;
  }
}

const DEFAULT_LIMITS: Partial<Record<Source, number>> = {
  vinted: 3,
  olx: 2,
  allegro_lokalnie: 1,
  sprzedajemy: 2,
  willhaben: 2,
  kleinanzeigen: 2,
  shpock: 2,
};

export class SourceConcurrencyLimiter {
  private semaphores = new Map<Source, Semaphore>();

  constructor(private readonly limits: Partial<Record<Source, number>> = DEFAULT_LIMITS) {}

  async run<T>(source: Source, fn: () => Promise<T>): Promise<T> {
    const semaphore = this.getSemaphore(source);
    await semaphore.acquire();
    try {
      return await fn();
    } finally {
      semaphore.release();
    }
  }

  private getSemaphore(source: Source): Semaphore {
    const current = this.semaphores.get(source);
    if (current) return current;

    const limit = Math.max(1, this.limits[source] ?? 1);
    const semaphore = new Semaphore(limit);
    this.semaphores.set(source, semaphore);
    return semaphore;
  }
}

function envLimitFor(source: Source): number | undefined {
  const specific = process.env[`SOURCE_LIMIT_${source.toUpperCase()}`];
  if (specific) return Number(specific);

  if (source === 'allegro_lokalnie' && process.env.SOURCE_LIMIT_ALLEGRO_LOKALNIE) {
    return Number(process.env.SOURCE_LIMIT_ALLEGRO_LOKALNIE);
  }

  const fallback = process.env.SOURCE_LIMIT_DEFAULT;
  return fallback ? Number(fallback) : undefined;
}

export function createSourceConcurrencyLimiter(): SourceConcurrencyLimiter {
  const limits: Partial<Record<Source, number>> = { ...DEFAULT_LIMITS };
  const sources = Object.keys(DEFAULT_LIMITS) as Source[];
  for (const source of sources) {
    const configured = envLimitFor(source);
    if (configured && Number.isFinite(configured)) {
      limits[source] = Math.max(1, configured);
    }
  }
  return new SourceConcurrencyLimiter(limits);
}

export function throttleAdapter(
  adapter: SourceAdapter,
  limiter: SourceConcurrencyLimiter,
): SourceAdapter {
  return {
    source: adapter.source,
    supportLevel: adapter.supportLevel as SourceSupportLevel,
    config: adapter.config,
    async searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]> {
      return limiter.run(adapter.source, () => adapter.searchListings(query, filters));
    },
    detectPromoted(raw: Record<string, unknown>): boolean {
      return adapter.detectPromoted(raw);
    },
    extractSellerSignals(raw: Record<string, unknown>) {
      return adapter.extractSellerSignals(raw);
    },
  };
}
