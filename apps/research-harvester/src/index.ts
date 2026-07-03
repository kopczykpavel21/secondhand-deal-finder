/**
 * Research harvester — one-time cross-sectional scrape of the CZ+DE secondhand
 * major-appliance market for the brand-durability-proxy study.
 *
 * Reuses the production fetch-based source adapters (no Playwright/browser is
 * launched — only the module is loaded). Iterates the brand×category×market
 * query matrix, de-duplicates by stable listing id across the whole run, and
 * persists incrementally (Postgres if DATABASE_URL is set, else JSONL).
 *
 * Usage:
 *   npm run harvest:pilot --workspace=apps/research-harvester        # WM × top-10 × CZ+DE
 *   npm run harvest       --workspace=apps/research-harvester        # full matrix
 *   tsx src/index.ts --pilot --dry-run                               # print plan only
 *   tsx src/index.ts --limit 4 --max-brands 1                        # tiny smoke test
 *
 * Flags:
 *   --pilot         use the pilot scope (washing machines × top-10 brands × CZ+DE)
 *   --dry-run       build the query matrix and print the plan; do not fetch
 *   --limit N       cap the number of queries executed
 *   --max-brands N  cap the number of brands per category
 *   --price-min N   pass a minimum price filter to the adapters (default: none)
 *
 * Env:
 *   DATABASE_URL            Postgres connection (optional; JSONL fallback if unset)
 *   HARVEST_OUT_DIR         JSONL output dir (default: ./data)
 *   INTER_QUERY_DELAY_MS    politeness delay between queries (default: 1500)
 */

import { randomUUID } from 'crypto';
import type { NormalizedListing, SearchFilters } from '@sdf/types';
import {
  BazosAdapter,
  SbazarAdapter,
  AukroAdapter,
  KleinanzeigeAdapter,
  ShpockAdapter,
} from '@sdf/source-adapters';
import {
  buildQueryMatrix,
  BRANDS,
  PILOT_OPTIONS,
  type BuildMatrixOptions,
  type HarvestMarket,
  type HarvestQuery,
} from './query-matrix.js';
import { saveBatch, type HarvestRecord } from './snapshot-store.js';

interface AdapterLike {
  source: string;
  searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]>;
}

// ─── CLI parsing ────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const hasFlag = (f: string) => argv.includes(f);
const flagValue = (f: string, fallback: string): string => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const pilot = hasFlag('--pilot');
const dryRun = hasFlag('--dry-run');
const queryLimit = Number(flagValue('--limit', '0')) || 0;
const maxBrands = Number(flagValue('--max-brands', '0')) || 0;
const priceMin = Number(flagValue('--price-min', '0')) || 0;
const interQueryDelayMs = Math.max(0, Number(process.env.INTER_QUERY_DELAY_MS ?? 1500));

// ─── Adapters per market (instantiated once, reused across queries) ──────────

function buildAdaptersForMarket(market: HarvestMarket): AdapterLike[] {
  return market === 'cz'
    ? [new BazosAdapter(), new SbazarAdapter(), new AukroAdapter()]
    : [new KleinanzeigeAdapter(), new ShpockAdapter()];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const options: BuildMatrixOptions = pilot ? { ...PILOT_OPTIONS } : {};
  if (maxBrands > 0) {
    options.brands = (options.brands ?? BRANDS).slice(0, maxBrands);
  }
  const marketsFlag = flagValue('--markets', '');
  if (marketsFlag) {
    options.markets = marketsFlag.split(',').map((m) => m.trim()) as HarvestMarket[];
  }

  let queries = buildQueryMatrix(options);
  if (queryLimit > 0) queries = queries.slice(0, queryLimit);

  const markets = [...new Set(queries.map((q) => q.market))] as HarvestMarket[];
  const byMarketCount = new Map<string, number>();
  const byCategoryCount = new Map<string, number>();
  queries.forEach((q) => {
    bump(byMarketCount, q.market);
    bump(byCategoryCount, q.categoryId);
  });

  console.log('━━━ Appliance durability harvest ━━━');
  console.log(`scope          : ${pilot ? 'PILOT' : 'FULL'}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`markets        : ${markets.join(', ')}`);
  console.log(`queries        : ${queries.length}  (${[...byMarketCount].map(([m, n]) => `${m}:${n}`).join(', ')})`);
  console.log(`categories     : ${[...byCategoryCount].map(([c, n]) => `${c}:${n}`).join(', ')}`);
  console.log(`sink           : ${process.env.DATABASE_URL ? 'postgres' : 'jsonl (no DATABASE_URL)'}`);
  console.log(`price-min      : ${priceMin || 'none'}`);
  console.log(`inter-query    : ${interQueryDelayMs}ms`);

  if (dryRun) {
    console.log('\nfirst 10 queries:');
    queries.slice(0, 10).forEach((q, i) =>
      console.log(`  ${String(i + 1).padStart(3)}. [${q.market}] ${q.categoryId.padEnd(16)} "${q.query}"`),
    );
    console.log('\n(dry-run — no requests made)');
    return;
  }

  const adaptersByMarket = new Map<HarvestMarket, AdapterLike[]>();
  for (const m of markets) adaptersByMarket.set(m, buildAdaptersForMarket(m));

  const batchId = `harvest_${new Date().toISOString().slice(0, 10)}_${randomUUID().slice(0, 8)}`;
  const filters: SearchFilters | undefined = priceMin > 0 ? { priceMin } : undefined;

  const seen = new Set<string>();
  const perSource = new Map<string, number>();
  const perMarket = new Map<string, number>();
  const errors: string[] = [];
  let totalPersisted = 0;
  let lastSink = '';

  console.log(`\nbatch          : ${batchId}\n`);

  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    const adapters = adaptersByMarket.get(q.market)!;

    const settled = await Promise.allSettled(
      adapters.map((a) => a.searchListings(q.query, filters)),
    );

    const records: HarvestRecord[] = [];
    settled.forEach((res, idx) => {
      const adapter = adapters[idx];
      if (res.status === 'rejected') {
        errors.push(`[${q.market}] ${adapter.source} "${q.query}": ${(res.reason as Error)?.message ?? res.reason}`);
        return;
      }
      for (const listing of res.value) {
        if (seen.has(listing.id)) continue;
        seen.add(listing.id);
        records.push({
          listing,
          market: q.market,
          categoryId: q.categoryId,
          brandQuery: q.brand,
          queryText: q.query,
        });
        bump(perSource, listing.source);
        bump(perMarket, q.market);
      }
    });

    if (records.length > 0) {
      const result = await saveBatch(batchId, records);
      totalPersisted += result.persisted;
      lastSink = result.sink === 'postgres' ? result.location : result.location;
    }

    console.log(
      `[${String(qi + 1).padStart(3)}/${queries.length}] ${q.market} "${q.query}" ` +
        `→ +${records.length} new (unique so far: ${seen.size})`,
    );

    if (qi < queries.length - 1 && interQueryDelayMs > 0) {
      await sleep(interQueryDelayMs);
    }
  }

  console.log('\n━━━ Summary ━━━');
  console.log(`batch          : ${batchId}`);
  console.log(`unique listings: ${seen.size}`);
  console.log(`persisted      : ${totalPersisted}  → ${process.env.DATABASE_URL ? 'appliance_listings_snapshot' : lastSink}`);
  console.log(`by source      : ${[...perSource].map(([s, n]) => `${s}:${n}`).join(', ') || '(none)'}`);
  console.log(`by market      : ${[...perMarket].map(([m, n]) => `${m}:${n}`).join(', ') || '(none)'}`);
  if (errors.length) {
    console.log(`\nadapter errors : ${errors.length}`);
    errors.slice(0, 20).forEach((e) => console.log(`  - ${e}`));
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[research-harvester] fatal error:', error);
    process.exit(1);
  });
