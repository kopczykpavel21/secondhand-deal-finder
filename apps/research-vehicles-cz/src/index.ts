/**
 * Czech passenger-vehicle research harvester.
 *
 * v1 is intentionally scoped as a proof-of-concept:
 * - Czech market only
 * - one-shot cross-sectional scrape
 * - generic marketplace adapters already present in the repo
 * - typed enrichment for year, mileage, defect language and seller type
 *
 * This is sufficient to produce the first brand×age exploratory tables and the
 * main paper dataset skeleton. It is not yet the final coverage-maximising
 * production scraper for a journal submission.
 */

import { randomUUID } from 'crypto';
import type { NormalizedListing, SearchFilters } from '@sdf/types';
import { AukroAdapter, BazosAdapter, SbazarAdapter, TipCarsAdapter } from '@sdf/source-adapters';
import {
  buildQueryMatrix,
  PILOT_BRANDS,
  PILOT_OPTIONS,
  VEHICLE_BRANDS,
  type BuildMatrixOptions,
  type VehicleHarvestQuery,
} from './query-matrix.js';
import { saveBatch, type HarvestRecord } from './snapshot-store.js';
import { enrichVehicleListing } from './vehicle-enrichment.js';

interface AdapterLike {
  source: string;
  searchListings(query: string, filters?: SearchFilters): Promise<NormalizedListing[]>;
}

const argv = process.argv.slice(2);
const hasFlag = (flag: string) => argv.includes(flag);
const flagValue = (flag: string, fallback: string): string => {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const pilot = hasFlag('--pilot');
const dryRun = hasFlag('--dry-run');
const queryLimit = Number(flagValue('--limit', '0')) || 0;
const maxBrands = Number(flagValue('--max-brands', '0')) || 0;
const maxModelsPerBrand = Number(flagValue('--max-models', '0')) || 0;
const priceMin = Number(flagValue('--price-min', '0')) || 0;
const targetListings = Number(flagValue('--target-listings', '0')) || 0;
const interQueryDelayMs = Math.max(0, Number(process.env.INTER_QUERY_DELAY_MS ?? 1500));

function buildAdapters(): AdapterLike[] {
  const adapters: AdapterLike[] = [new TipCarsAdapter(), new BazosAdapter(), new SbazarAdapter()];
  if (process.env.ENABLE_AUKRO_RESEARCH === 'true') {
    adapters.push(new AukroAdapter());
  }
  return adapters;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function buildOptions(): BuildMatrixOptions {
  const options: BuildMatrixOptions = pilot ? { ...PILOT_OPTIONS } : {};

  if (maxBrands > 0) {
    const sourceBrands = options.brands ?? VEHICLE_BRANDS.map((item) => item.brand);
    options.brands = sourceBrands.slice(0, maxBrands);
  }

  if (maxModelsPerBrand > 0) {
    options.maxModelsPerBrand = maxModelsPerBrand;
  }

  return options;
}

async function run(): Promise<void> {
  const options = buildOptions();
  let queries = buildQueryMatrix(options);
  if (queryLimit > 0) queries = queries.slice(0, queryLimit);

  const byKind = new Map<string, number>();
  const byBrand = new Map<string, number>();
  for (const query of queries) {
    bump(byKind, query.kind);
    bump(byBrand, query.brand);
  }

  console.log('━━━ Czech vehicle durability harvest ━━━');
  console.log(`scope          : ${pilot ? `PILOT (${PILOT_BRANDS.join(', ')})` : 'FULL'}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`queries        : ${queries.length}`);
  console.log(`query kinds    : ${[...byKind].map(([kind, count]) => `${kind}:${count}`).join(', ')}`);
  console.log(`brands         : ${byBrand.size}`);
  console.log(`sink           : ${process.env.DATABASE_URL ? 'postgres' : 'jsonl (no DATABASE_URL)'}`);
  console.log(`price-min      : ${priceMin || 'none'}`);
  console.log(`target-listings: ${targetListings || 'none'}`);
  console.log(`inter-query    : ${interQueryDelayMs}ms`);

  if (dryRun) {
    console.log('\nfirst 12 queries:');
    queries.slice(0, 12).forEach((query, index) => {
      console.log(`  ${String(index + 1).padStart(3)}. [${query.kind}] ${query.brand}${query.model ? ` / ${query.model}` : ''} → "${query.query}"`);
    });
    console.log('\n(dry-run — no requests made)');
    return;
  }

  const adapters = buildAdapters();
  const batchId = `vehicle_harvest_${new Date().toISOString().slice(0, 10)}_${randomUUID().slice(0, 8)}`;
  const filters: SearchFilters | undefined = priceMin > 0 ? { priceMin } : undefined;

  const seen = new Set<string>();
  const perSource = new Map<string, number>();
  const perBrand = new Map<string, number>();
  const listingKinds = new Map<string, number>();
  const yearSources = new Map<string, number>();
  const errors: string[] = [];
  let totalPersisted = 0;
  let skippedParts = 0;

  console.log(`\nbatch          : ${batchId}\n`);

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    const settled = await Promise.allSettled(
      adapters.map((adapter) => adapter.searchListings(query.query, filters)),
    );

    const records: HarvestRecord[] = [];

    settled.forEach((result, adapterIndex) => {
      const adapter = adapters[adapterIndex];
      if (result.status === 'rejected') {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`[${adapter.source}] "${query.query}": ${reason}`);
        return;
      }

      for (const listing of result.value) {
        if (seen.has(listing.id)) continue;

        const enrichment = enrichVehicleListing(listing, query.brand, query.model);
        bump(listingKinds, enrichment.listingKind);

        if (enrichment.listingKind === 'parts') {
          skippedParts += 1;
          continue;
        }
        if (priceMin > 0 && (listing.price == null || listing.price < priceMin)) {
          continue;
        }

        seen.add(listing.id);
        records.push({ listing, query, enrichment });
        bump(perSource, listing.source);
        bump(perBrand, enrichment.normalizedBrand ?? query.brand);
        bump(yearSources, enrichment.yearOriginSource);
      }
    });

    if (records.length > 0) {
      const result = await saveBatch(batchId, records);
      totalPersisted += result.persisted;
    }

    console.log(
      `[${String(queryIndex + 1).padStart(3)}/${queries.length}] "${query.query}" ` +
      `→ +${records.length} vehicle listings (unique so far: ${seen.size}, skipped parts: ${skippedParts})`,
    );

    if (targetListings > 0 && seen.size >= targetListings) {
      console.log(`\nReached target listing count (${targetListings}). Stopping early.`);
      break;
    }

    if (queryIndex < queries.length - 1 && interQueryDelayMs > 0) {
      await sleep(interQueryDelayMs);
    }
  }

  console.log('\n━━━ Summary ━━━');
  console.log(`batch          : ${batchId}`);
  console.log(`unique listings: ${seen.size}`);
  console.log(`persisted      : ${totalPersisted}`);
  console.log(`by source      : ${[...perSource].map(([source, count]) => `${source}:${count}`).join(', ') || '(none)'}`);
  console.log(`by brand       : ${[...perBrand].slice(0, 12).map(([brand, count]) => `${brand}:${count}`).join(', ') || '(none)'}`);
  console.log(`listing kinds  : ${[...listingKinds].map(([kind, count]) => `${kind}:${count}`).join(', ') || '(none)'}`);
  console.log(`year sources   : ${[...yearSources].map(([source, count]) => `${source}:${count}`).join(', ') || '(none)'}`);
  console.log(`skipped parts  : ${skippedParts}`);

  if (errors.length > 0) {
    console.log(`\nadapter errors : ${errors.length}`);
    errors.slice(0, 20).forEach((item) => console.log(`  - ${item}`));
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[research-vehicles-cz] fatal error:', error);
    process.exit(1);
  });
