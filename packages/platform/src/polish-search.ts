import { SearchCoordinator, type SearchCache } from '@sdf/core';
import { getMarketConfig } from '@sdf/types';
import type { SourceAdapter } from '@sdf/types';
import {
  KleinanzeigeAdapter,
  MockAdapter,
  OlxAdapter,
  ShpockAdapter,
  SprzedajemyAdapter,
  VintedAdapter,
  WillhabenAdapter,
} from '@sdf/source-adapters';
import {
  createSourceConcurrencyLimiter,
  throttleAdapter,
  type SourceConcurrencyLimiter,
} from './source-limiter';

export function buildPolishAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') {
    return [new MockAdapter()];
  }

  const adapters: SourceAdapter[] = [];
  if (process.env.ENABLE_VINTED !== 'false') {
    adapters.push(new VintedAdapter({
      baseUrl: 'https://www.vinted.pl',
      marketConfig: getMarketConfig('pl'),
    }));
  }
  if (process.env.ENABLE_OLX !== 'false') adapters.push(new OlxAdapter());
  if (process.env.ENABLE_SPRZEDAJEMY !== 'false') adapters.push(new SprzedajemyAdapter());

  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}

export function createPolishSearchCoordinator(options: {
  cache?: SearchCache | null;
  limiter?: SourceConcurrencyLimiter;
} = {}): SearchCoordinator {
  return new SearchCoordinator(
    buildPolishAdapters({ limiter: options.limiter }),
    { marketConfig: getMarketConfig('pl'), cache: options.cache ?? null, cacheNamespace: 'pl' },
  );
}

export function createProductionPolishSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createPolishSearchCoordinator({
    cache: cache ?? null,
    limiter: createSourceConcurrencyLimiter(),
  });
}

export function buildGermanAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') {
    return [new MockAdapter()];
  }

  const adapters: SourceAdapter[] = [];
  if (process.env.ENABLE_VINTED !== 'false') {
    adapters.push(new VintedAdapter({
      baseUrl: 'https://www.vinted.de',
      marketConfig: getMarketConfig('de'),
    }));
  }
  if (process.env.ENABLE_WILLHABEN !== 'false') adapters.push(new WillhabenAdapter());
  if (process.env.ENABLE_KLEINANZEIGEN !== 'false') adapters.push(new KleinanzeigeAdapter());

  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}

export function createGermanSearchCoordinator(options: {
  cache?: SearchCache | null;
  limiter?: SourceConcurrencyLimiter;
} = {}): SearchCoordinator {
  return new SearchCoordinator(
    buildGermanAdapters({ limiter: options.limiter }),
    { marketConfig: getMarketConfig('de'), cache: options.cache ?? null, cacheNamespace: 'de' },
  );
}

export function createProductionGermanSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createGermanSearchCoordinator({
    cache: cache ?? null,
    limiter: createSourceConcurrencyLimiter(),
  });
}

export function buildAustriaAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') {
    return [new MockAdapter()];
  }

  const adapters: SourceAdapter[] = [];
  if (process.env.ENABLE_VINTED !== 'false') {
    adapters.push(new VintedAdapter({
      baseUrl: 'https://www.vinted.de',
      marketConfig: getMarketConfig('at'),
    }));
  }
  if (process.env.ENABLE_WILLHABEN !== 'false') adapters.push(new WillhabenAdapter());
  if (process.env.ENABLE_SHPOCK !== 'false') adapters.push(new ShpockAdapter());

  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}

export function createAustriaSearchCoordinator(options: {
  cache?: SearchCache | null;
  limiter?: SourceConcurrencyLimiter;
} = {}): SearchCoordinator {
  return new SearchCoordinator(
    buildAustriaAdapters({ limiter: options.limiter }),
    { marketConfig: getMarketConfig('at'), cache: options.cache ?? null, cacheNamespace: 'at' },
  );
}

export function createProductionAustriaSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createAustriaSearchCoordinator({
    cache: cache ?? null,
    limiter: createSourceConcurrencyLimiter(),
  });
}
