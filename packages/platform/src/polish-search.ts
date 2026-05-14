import { SearchCoordinator, type SearchCache } from '@sdf/core';
import { getMarketConfig } from '@sdf/types';
import type { SourceAdapter } from '@sdf/types';
import {
  AukroAdapter,
  BazosAdapter,
  BazosSkAdapter,
  BlocketAdapter,
  FlerAdapter,
  GumtreeAdapter,
  JofogasAdapter,
  KleinanzeigeAdapter,
  LeBonCoinAdapter,
  MarktplaatsAdapter,
  MockAdapter,
  OlxAdapter,
  OlxRoAdapter,
  SbazarAdapter,
  ShpockAdapter,
  SprzedajemyAdapter,
  SubitoAdapter,
  TweedehandsAdapter,
  VintedAdapter,
  WallapopAdapter,
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

  const adapters: SourceAdapter[] = [
    new VintedAdapter({
      baseUrl: 'https://www.vinted.pl',
      marketConfig: getMarketConfig('pl'),
    }),
  ];
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

export function buildSpanishAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') return [new MockAdapter()];
  const adapters: SourceAdapter[] = [new WallapopAdapter()];
  if (process.env.ENABLE_VINTED !== 'false') adapters.push(new VintedAdapter({ baseUrl: 'https://www.vinted.es', marketConfig: getMarketConfig('es') }));
  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}

export function createSpanishSearchCoordinator(options: { cache?: SearchCache | null; limiter?: SourceConcurrencyLimiter } = {}): SearchCoordinator {
  return new SearchCoordinator(buildSpanishAdapters({ limiter: options.limiter }), { marketConfig: getMarketConfig('es'), cache: options.cache ?? null, cacheNamespace: 'es' });
}

export function createProductionSpanishSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createSpanishSearchCoordinator({ cache: cache ?? null, limiter: createSourceConcurrencyLimiter() });
}

export function buildDutchAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') return [new MockAdapter()];
  const adapters: SourceAdapter[] = [new MarktplaatsAdapter()];
  if (process.env.ENABLE_VINTED !== 'false') adapters.push(new VintedAdapter({ baseUrl: 'https://www.vinted.nl', marketConfig: getMarketConfig('nl') }));
  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}

export function createDutchSearchCoordinator(options: { cache?: SearchCache | null; limiter?: SourceConcurrencyLimiter } = {}): SearchCoordinator {
  return new SearchCoordinator(buildDutchAdapters({ limiter: options.limiter }), { marketConfig: getMarketConfig('nl'), cache: options.cache ?? null, cacheNamespace: 'nl' });
}

export function createProductionDutchSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createDutchSearchCoordinator({ cache: cache ?? null, limiter: createSourceConcurrencyLimiter() });
}

export function buildBritishAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') return [new MockAdapter()];
  const adapters: SourceAdapter[] = [new GumtreeAdapter()];
  if (process.env.ENABLE_VINTED !== 'false') adapters.push(new VintedAdapter({ baseUrl: 'https://www.vinted.co.uk', marketConfig: getMarketConfig('gb') }));
  if (process.env.ENABLE_SHPOCK !== 'false') adapters.push(new ShpockAdapter());
  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}

export function createBritishSearchCoordinator(options: { cache?: SearchCache | null; limiter?: SourceConcurrencyLimiter } = {}): SearchCoordinator {
  return new SearchCoordinator(buildBritishAdapters({ limiter: options.limiter }), { marketConfig: getMarketConfig('gb'), cache: options.cache ?? null, cacheNamespace: 'gb' });
}

export function createProductionBritishSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createBritishSearchCoordinator({ cache: cache ?? null, limiter: createSourceConcurrencyLimiter() });
}

export function buildFrenchAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') {
    return [new MockAdapter()];
  }

  const adapters: SourceAdapter[] = [new LeBonCoinAdapter()];
  if (process.env.ENABLE_VINTED !== 'false') {
    adapters.push(new VintedAdapter({
      baseUrl: 'https://www.vinted.fr',
      marketConfig: getMarketConfig('fr'),
    }));
  }

  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}

export function createFrenchSearchCoordinator(options: {
  cache?: SearchCache | null;
  limiter?: SourceConcurrencyLimiter;
} = {}): SearchCoordinator {
  return new SearchCoordinator(
    buildFrenchAdapters({ limiter: options.limiter }),
    { marketConfig: getMarketConfig('fr'), cache: options.cache ?? null, cacheNamespace: 'fr' },
  );
}

export function createProductionFrenchSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createFrenchSearchCoordinator({
    cache: cache ?? null,
    limiter: createSourceConcurrencyLimiter(),
  });
}

export function buildItalianAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') return [new MockAdapter()];
  const adapters: SourceAdapter[] = [new SubitoAdapter()];
  if (process.env.ENABLE_VINTED !== 'false') adapters.push(new VintedAdapter({ baseUrl: 'https://www.vinted.it', marketConfig: getMarketConfig('it') }));
  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}
export function createItalianSearchCoordinator(options: { cache?: SearchCache | null; limiter?: SourceConcurrencyLimiter } = {}): SearchCoordinator {
  return new SearchCoordinator(buildItalianAdapters({ limiter: options.limiter }), { marketConfig: getMarketConfig('it'), cache: options.cache ?? null, cacheNamespace: 'it' });
}
export function createProductionItalianSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createItalianSearchCoordinator({ cache: cache ?? null, limiter: createSourceConcurrencyLimiter() });
}

export function buildBelgianAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') return [new MockAdapter()];
  const adapters: SourceAdapter[] = [new TweedehandsAdapter()];
  if (process.env.ENABLE_VINTED !== 'false') adapters.push(new VintedAdapter({ baseUrl: 'https://www.vinted.be', marketConfig: getMarketConfig('be') }));
  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}
export function createBelgianSearchCoordinator(options: { cache?: SearchCache | null; limiter?: SourceConcurrencyLimiter } = {}): SearchCoordinator {
  return new SearchCoordinator(buildBelgianAdapters({ limiter: options.limiter }), { marketConfig: getMarketConfig('be'), cache: options.cache ?? null, cacheNamespace: 'be' });
}
export function createProductionBelgianSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createBelgianSearchCoordinator({ cache: cache ?? null, limiter: createSourceConcurrencyLimiter() });
}

export function buildSwedishAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') return [new MockAdapter()];
  const adapters: SourceAdapter[] = [new BlocketAdapter()];
  if (process.env.ENABLE_VINTED !== 'false') adapters.push(new VintedAdapter({ baseUrl: 'https://www.vinted.se', marketConfig: getMarketConfig('se') }));
  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}
export function createSwedishSearchCoordinator(options: { cache?: SearchCache | null; limiter?: SourceConcurrencyLimiter } = {}): SearchCoordinator {
  return new SearchCoordinator(buildSwedishAdapters({ limiter: options.limiter }), { marketConfig: getMarketConfig('se'), cache: options.cache ?? null, cacheNamespace: 'se' });
}
export function createProductionSwedishSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createSwedishSearchCoordinator({ cache: cache ?? null, limiter: createSourceConcurrencyLimiter() });
}

export function buildHungarianAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') return [new MockAdapter()];
  const adapters: SourceAdapter[] = [new JofogasAdapter()];
  if (process.env.ENABLE_VINTED !== 'false') adapters.push(new VintedAdapter({ baseUrl: 'https://www.vinted.hu', marketConfig: getMarketConfig('hu') }));
  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}
export function createHungarianSearchCoordinator(options: { cache?: SearchCache | null; limiter?: SourceConcurrencyLimiter } = {}): SearchCoordinator {
  return new SearchCoordinator(buildHungarianAdapters({ limiter: options.limiter }), { marketConfig: getMarketConfig('hu'), cache: options.cache ?? null, cacheNamespace: 'hu' });
}
export function createProductionHungarianSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createHungarianSearchCoordinator({ cache: cache ?? null, limiter: createSourceConcurrencyLimiter() });
}

export function buildRomanianAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') {
    return [new MockAdapter()];
  }

  const adapters: SourceAdapter[] = [new OlxRoAdapter()];
  if (process.env.ENABLE_VINTED !== 'false') {
    adapters.push(new VintedAdapter({
      baseUrl: 'https://www.vinted.ro',
      marketConfig: getMarketConfig('ro'),
    }));
  }

  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}

export function createRomanianSearchCoordinator(options: {
  cache?: SearchCache | null;
  limiter?: SourceConcurrencyLimiter;
} = {}): SearchCoordinator {
  return new SearchCoordinator(
    buildRomanianAdapters({ limiter: options.limiter }),
    { marketConfig: getMarketConfig('ro'), cache: options.cache ?? null, cacheNamespace: 'ro' },
  );
}

export function createProductionRomanianSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createRomanianSearchCoordinator({
    cache: cache ?? null,
    limiter: createSourceConcurrencyLimiter(),
  });
}

export function buildSlovakAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') {
    return [new MockAdapter()];
  }

  const adapters: SourceAdapter[] = [new BazosSkAdapter()];
  if (process.env.ENABLE_VINTED !== 'false') {
    adapters.push(new VintedAdapter({
      baseUrl: 'https://www.vinted.sk',
      marketConfig: getMarketConfig('sk'),
    }));
  }

  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}

export function createSlovakSearchCoordinator(options: {
  cache?: SearchCache | null;
  limiter?: SourceConcurrencyLimiter;
} = {}): SearchCoordinator {
  return new SearchCoordinator(
    buildSlovakAdapters({ limiter: options.limiter }),
    { marketConfig: getMarketConfig('sk'), cache: options.cache ?? null, cacheNamespace: 'sk' },
  );
}

export function createProductionSlovakSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createSlovakSearchCoordinator({
    cache: cache ?? null,
    limiter: createSourceConcurrencyLimiter(),
  });
}

export function buildCzechAdapters(options: {
  limiter?: SourceConcurrencyLimiter;
} = {}): SourceAdapter[] {
  if (process.env.USE_MOCK_ADAPTERS === 'true') {
    return [new MockAdapter()];
  }

  const adapters: SourceAdapter[] = [new BazosAdapter()];
  if (process.env.ENABLE_SBAZAR !== 'false') adapters.push(new SbazarAdapter());
  if (process.env.ENABLE_VINTED !== 'false') adapters.push(new VintedAdapter({ marketConfig: getMarketConfig('cz') }));
  if (process.env.ENABLE_AUKRO !== 'false') adapters.push(new AukroAdapter());
  if (process.env.ENABLE_FLER !== 'false') adapters.push(new FlerAdapter());

  if (!options.limiter) return adapters;
  return adapters.map((adapter) => throttleAdapter(adapter, options.limiter!));
}

export function createCzechSearchCoordinator(options: {
  cache?: SearchCache | null;
  limiter?: SourceConcurrencyLimiter;
} = {}): SearchCoordinator {
  return new SearchCoordinator(
    buildCzechAdapters({ limiter: options.limiter }),
    { marketConfig: getMarketConfig('cz'), cache: options.cache ?? null, cacheNamespace: 'cz' },
  );
}

export function createProductionCzechSearchCoordinator(cache?: SearchCache | null): SearchCoordinator {
  return createCzechSearchCoordinator({
    cache: cache ?? null,
    limiter: createSourceConcurrencyLimiter(),
  });
}
