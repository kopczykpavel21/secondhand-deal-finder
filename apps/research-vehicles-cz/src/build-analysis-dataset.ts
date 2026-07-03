import { promises as fs } from 'fs';
import path from 'path';
import { enrichVehicleListing, type VehicleEnrichment } from './vehicle-enrichment.js';
import {
  denominatorKey,
  denominatorKeyBrandOnly,
  type ActiveStockDenominatorRow,
  type RegistrationDenominatorRow,
} from './denominator-schema.js';

interface StoredVehicleRecord {
  batchId: string;
  capturedAt: string;
  source: string;
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  currency: string;
  location: string | null;
  sellerName?: string | null;
  rawMetadata?: Record<string, unknown> | null;
  postedAt?: string | null;
  query: {
    kind: string;
    brand: string;
    model: string | null;
    query: string;
  };
  enrichment: VehicleEnrichment;
}

interface AnalysisListingRow {
  batch_id: string;
  listing_id: string;
  source: string;
  brand: string;
  model: string | null;
  cohort_year: number;
  vehicle_age: number;
  age_band: string;
  price_czk: number | null;
  log_price: number | null;
  mileage_km: number | null;
  mileage_100k: number | null;
  fuel_type: string | null;
  transmission: string | null;
  body_type: string | null;
  seller_type: string;
  region: string | null;
  year_origin_source: string;
  year_origin_confidence: number;
  defect_indicator: number;
  repair_needed: number;
  accident_damaged: number;
  engine_issue: number;
  transmission_issue: number;
  rust_issue: number;
  electronics_issue: number;
  service_history: number;
  first_owner: number;
  garaged: number;
  registrations: number | null;
  active_stock: number | null;
  denominator_basis: 'registrations_only' | 'registrations_and_active_stock';
}

interface CohortAggregateRow {
  brand: string;
  model: string | null;
  cohort_year: number;
  age_band: string;
  listing_count: number;
  older_15_plus_count: number;
  median_price_czk: number | null;
  median_mileage_km: number | null;
  defect_rate: number;
  registrations: number | null;
  active_stock: number | null;
  listings_per_registration: number | null;
  listings_per_active_stock: number | null;
  secondary_market_survival_intensity_proxy: number | null;
  denominator_basis: 'registrations_only' | 'registrations_and_active_stock';
  survival_metric_label: string;
}

const argv = process.argv.slice(2);

function flagValue(flag: string, fallback: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function ageBand(vehicleAge: number): string {
  if (vehicleAge < 5) return '0-4';
  if (vehicleAge < 10) return '5-9';
  if (vehicleAge < 15) return '10-14';
  if (vehicleAge < 20) return '15-19';
  return '20+';
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function csvEscape(value: string | number | null): string {
  if (value == null) return '';
  const text = String(value);
  if (!/[,"\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function writeCsv(file: string, rows: Array<Record<string, string | number | null>>): Promise<void> {
  if (rows.length === 0) {
    await fs.writeFile(file, '', 'utf8');
    return;
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ];
  await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf8');
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((value) => value.trim());
}

async function readCsv(file: string): Promise<Array<Record<string, string>>> {
  const raw = await fs.readFile(file, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

async function readJsonl(file: string): Promise<StoredVehicleRecord[]> {
  const raw = await fs.readFile(file, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StoredVehicleRecord);
}

async function latestJsonl(dir: string): Promise<string> {
  const entries = await fs.readdir(dir);
  const files = entries.filter((entry) => entry.endsWith('.jsonl'));
  if (files.length === 0) throw new Error(`No JSONL files found in ${dir}`);
  const withStats = await Promise.all(
    files.map(async (file) => {
      const fullPath = path.join(dir, file);
      const stat = await fs.stat(fullPath);
      return { file, fullPath, mtimeMs: stat.mtimeMs };
    }),
  );
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withStats[0].fullPath;
}

function parseRegistrations(rows: Array<Record<string, string>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const brand = row.brand || row.make || row.znacka;
    const model = row.model || row.typ || row.model_name || null;
    const cohortYear = Number(row.cohort_year || row.year || row.rok);
    const registrations = Number(row.registrations || row.count || row.pocet);
    if (!brand || !Number.isFinite(cohortYear) || !Number.isFinite(registrations)) continue;

    out.set(denominatorKey(brand, model, cohortYear), registrations);
    out.set(denominatorKeyBrandOnly(brand, cohortYear), registrations);
  }
  return out;
}

function parseActiveStock(rows: Array<Record<string, string>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const brand = row.brand || row.make || row.znacka;
    const model = row.model || row.typ || row.model_name || null;
    const cohortYear = Number(row.cohort_year || row.year || row.rok);
    const activeStock = Number(row.active_stock || row.stock || row.pocet);
    if (!brand || !Number.isFinite(cohortYear) || !Number.isFinite(activeStock)) continue;

    out.set(denominatorKey(brand, model, cohortYear), activeStock);
    out.set(denominatorKeyBrandOnly(brand, cohortYear), activeStock);
  }
  return out;
}

function flagNumber(value: boolean): number {
  return value ? 1 : 0;
}

async function run(): Promise<void> {
  const inputDir = flagValue('--input-dir', path.join(process.cwd(), 'data'));
  const inputFile = flagValue('--file', '');
  const registrationsFile = flagValue('--registrations', path.join(process.cwd(), 'data', 'denominators', 'cz_new_registrations.csv'));
  const activeStockFile = flagValue('--active-stock', path.join(process.cwd(), 'data', 'denominators', 'cz_active_stock.csv'));
  const outputDir = flagValue('--output-dir', path.join(process.cwd(), 'data', 'analysis'));
  const priceMin = Number(flagValue('--price-min', '0')) || 0;
  const sources = new Set(
    flagValue('--sources', 'tipcars,bazos,sbazar')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const harvestFile = inputFile || await latestJsonl(inputDir);
  const harvested = await readJsonl(harvestFile);
  try {
    await fs.access(registrationsFile);
  } catch {
    throw new Error(
      `Missing registrations denominator CSV at ${registrationsFile}. ` +
      `Run convert-sda-registrations first with a real SDA monthly XLSX path.`,
    );
  }
  const registrationRows = await readCsv(registrationsFile);
  const registrationMap = parseRegistrations(registrationRows);
  const registrationYears = registrationRows
    .map((row) => Number(row.cohort_year || row.year || row.rok))
    .filter((value) => Number.isFinite(value));
  const registrationMinYear = registrationYears.length > 0 ? Math.min(...registrationYears) : null;
  const registrationMaxYear = registrationYears.length > 0 ? Math.max(...registrationYears) : null;
  const activeStockMap = await fs.access(activeStockFile).then(
    async () => parseActiveStock(await readCsv(activeStockFile)),
    async () => new Map<string, number>(),
  );

  const listingRows: AnalysisListingRow[] = [];
  const denominatorBasis: AnalysisListingRow['denominator_basis'] =
    activeStockMap.size > 0 ? 'registrations_and_active_stock' : 'registrations_only';
  const aggregateMap = new Map<string, {
    count: number;
    older15Count: number;
    prices: number[];
    mileages: number[];
    defectCount: number;
    registrations: number | null;
    activeStock: number | null;
  }>();

  for (const record of harvested) {
    if (!sources.has(record.source)) continue;
    if (priceMin > 0 && (record.price == null || record.price < priceMin)) continue;

    const refreshed = enrichVehicleListing(
      {
        title: record.title,
        description: record.description,
        sellerName: record.sellerName ?? null,
        location: record.location,
        rawMetadata: record.rawMetadata ?? {},
      } as never,
      record.query.brand,
      record.query.model,
    );

    if (refreshed.listingKind !== 'vehicle') continue;

    const brand = refreshed.normalizedBrand ?? record.query.brand;
    const model = refreshed.normalizedModel;
    const cohortYear = refreshed.yearOrigin;
    if (!brand || !cohortYear) continue;

    const vehicleAge = new Date().getFullYear() - cohortYear;
    const band = ageBand(vehicleAge);
    const registrationKey =
      registrationMap.get(denominatorKey(brand, model, cohortYear)) != null
        ? denominatorKey(brand, model, cohortYear)
        : denominatorKeyBrandOnly(brand, cohortYear);
    const stockKey =
      activeStockMap.get(denominatorKey(brand, model, cohortYear)) != null
        ? denominatorKey(brand, model, cohortYear)
        : denominatorKeyBrandOnly(brand, cohortYear);

    const registrations = registrationMap.get(registrationKey) ?? null;
    const activeStock = activeStockMap.get(stockKey) ?? null;
    const flags = refreshed.flags;
    const defectIndicator = Number(
      flags.repairNeeded ||
      flags.accidentDamaged ||
      flags.engineIssue ||
      flags.transmissionIssue ||
      flags.rustIssue,
    );

    const row: AnalysisListingRow = {
      batch_id: record.batchId,
      listing_id: record.id,
      source: record.source,
      brand,
      model,
      cohort_year: cohortYear,
      vehicle_age: vehicleAge,
      age_band: band,
      price_czk: record.price,
      log_price: record.price && record.price > 0 ? Math.log(record.price) : null,
      mileage_km: refreshed.mileageKm,
      mileage_100k: refreshed.mileageKm != null ? refreshed.mileageKm / 100_000 : null,
      fuel_type: refreshed.fuelType,
      transmission: refreshed.transmission,
      body_type: refreshed.bodyType,
      seller_type: refreshed.sellerType,
      region: record.location,
      year_origin_source: refreshed.yearOriginSource,
      year_origin_confidence: refreshed.yearOriginConfidence,
      defect_indicator: defectIndicator,
      repair_needed: flagNumber(flags.repairNeeded),
      accident_damaged: flagNumber(flags.accidentDamaged),
      engine_issue: flagNumber(flags.engineIssue),
      transmission_issue: flagNumber(flags.transmissionIssue),
      rust_issue: flagNumber(flags.rustIssue),
      electronics_issue: flagNumber(flags.electronicsIssue),
      service_history: flagNumber(flags.serviceHistory),
      first_owner: flagNumber(flags.firstOwner),
      garaged: flagNumber(flags.garaged),
      registrations,
      active_stock: activeStock,
      denominator_basis: denominatorBasis,
    };

    listingRows.push(row);

    const aggregateKey = `${brand}|||${model ?? ''}|||${cohortYear}|||${band}`;
    const bucket = aggregateMap.get(aggregateKey) ?? {
      count: 0,
      older15Count: 0,
      prices: [],
      mileages: [],
      defectCount: 0,
      registrations,
      activeStock,
    };
    bucket.count += 1;
    if (vehicleAge >= 15) bucket.older15Count += 1;
    if (record.price != null) bucket.prices.push(record.price);
    if (refreshed.mileageKm != null) bucket.mileages.push(refreshed.mileageKm);
    bucket.defectCount += defectIndicator;
    aggregateMap.set(aggregateKey, bucket);
  }

  const aggregateRows: CohortAggregateRow[] = [...aggregateMap.entries()].map(([key, bucket]) => {
    const [brand, modelValue, cohortYearText, band] = key.split('|||');
    const registrations = bucket.registrations;
    const activeStock = bucket.activeStock;
    const secondaryMarketSurvivalIntensityProxy =
      registrations && registrations > 0 ? bucket.count / registrations : null;
    return {
      brand,
      model: modelValue || null,
      cohort_year: Number(cohortYearText),
      age_band: band,
      listing_count: bucket.count,
      older_15_plus_count: bucket.older15Count,
      median_price_czk: median(bucket.prices),
      median_mileage_km: median(bucket.mileages),
      defect_rate: bucket.count > 0 ? Number((bucket.defectCount / bucket.count).toFixed(4)) : 0,
      registrations,
      active_stock: activeStock,
      listings_per_registration: secondaryMarketSurvivalIntensityProxy,
      listings_per_active_stock: activeStock && activeStock > 0 ? bucket.count / activeStock : null,
      secondary_market_survival_intensity_proxy: secondaryMarketSurvivalIntensityProxy,
      denominator_basis: activeStockMap.size > 0 ? 'registrations_and_active_stock' : 'registrations_only',
      survival_metric_label:
        activeStockMap.size > 0
          ? 'listings_per_registration is a secondary-market survival intensity proxy; listings_per_active_stock is closer to resale intensity conditional on surviving stock'
          : 'listings_per_registration is a secondary-market survival intensity proxy, not a pure survival measure',
    };
  });
  const missingRegistrationRows = listingRows
    .filter((row) => row.registrations == null)
    .map((row) => ({
      listing_id: row.listing_id,
      source: row.source,
      brand: row.brand,
      model: row.model,
      cohort_year: row.cohort_year,
      year_origin_source: row.year_origin_source,
      year_origin_confidence: row.year_origin_confidence,
      denominator_range_status:
        registrationMinYear != null && registrationMaxYear != null
          ? row.cohort_year < registrationMinYear
            ? 'below_range'
            : row.cohort_year > registrationMaxYear
              ? 'above_range'
              : 'in_range_unmatched'
          : 'unknown',
    }));
  const matchedRegistrationCount = listingRows.length - missingRegistrationRows.length;
  const registrationCoverage =
    listingRows.length > 0 ? Number(((matchedRegistrationCount / listingRows.length) * 100).toFixed(1)) : null;
  const mainRegressionRows = listingRows.filter((row) => row.registrations != null);
  const mainRegressionCoverage =
    listingRows.length > 0 ? Number(((mainRegressionRows.length / listingRows.length) * 100).toFixed(1)) : null;

  const metadata = {
    generated_at: new Date().toISOString(),
    harvest_input: harvestFile,
    registrations_file: registrationsFile,
    active_stock_file: activeStockMap.size > 0 ? activeStockFile : null,
    sources_included: [...sources],
    price_min: priceMin || null,
    denominator_basis: activeStockMap.size > 0 ? 'registrations_and_active_stock' : 'registrations_only',
    primary_survival_interpretation:
      activeStockMap.size > 0
        ? 'Use listings_per_registration as a secondary-market survival intensity proxy and listings_per_active_stock as a stronger resale-intensity denominator conditional on observed stock.'
        : 'Use listings_per_registration as a secondary-market survival intensity proxy. Do not interpret it as pure physical survival.',
    denominator_year_range:
      registrationMinYear != null && registrationMaxYear != null
        ? { min: registrationMinYear, max: registrationMaxYear }
        : null,
    registration_merge: {
      matched_rows: matchedRegistrationCount,
      total_rows: listingRows.length,
      coverage_percent: registrationCoverage,
      main_regression_rows: mainRegressionRows.length,
      main_regression_rule:
        'Keep out-of-range cohorts in the raw dataset, but drop rows without registrations from denominator-normalized main regressions.',
    },
  };

  await fs.mkdir(outputDir, { recursive: true });
  await writeCsv(path.join(outputDir, 'vehicle_listing_analysis_dataset.csv'), listingRows as unknown as Array<Record<string, string | number | null>>);
  await writeCsv(
    path.join(outputDir, 'vehicle_listing_analysis_dataset_main_sample.csv'),
    mainRegressionRows as unknown as Array<Record<string, string | number | null>>,
  );
  await writeCsv(path.join(outputDir, 'vehicle_cohort_aggregate_dataset.csv'), aggregateRows as unknown as Array<Record<string, string | number | null>>);
  await writeCsv(
    path.join(outputDir, 'vehicle_listing_missing_registrations.csv'),
    missingRegistrationRows as unknown as Array<Record<string, string | number | null>>,
  );
  await fs.writeFile(path.join(outputDir, 'vehicle_listing_analysis_dataset.json'), JSON.stringify(listingRows, null, 2), 'utf8');
  await fs.writeFile(
    path.join(outputDir, 'vehicle_listing_analysis_dataset_main_sample.json'),
    JSON.stringify(mainRegressionRows, null, 2),
    'utf8',
  );
  await fs.writeFile(path.join(outputDir, 'vehicle_cohort_aggregate_dataset.json'), JSON.stringify(aggregateRows, null, 2), 'utf8');
  await fs.writeFile(path.join(outputDir, 'analysis_metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

  console.log('━━━ Vehicle analysis dataset build ━━━');
  console.log(`harvest input   : ${harvestFile}`);
  console.log(`listing rows    : ${listingRows.length}`);
  console.log(`aggregate rows  : ${aggregateRows.length}`);
  console.log(`sources        : ${[...sources].join(', ')}`);
  console.log(`price-min      : ${priceMin || 'none'}`);
  console.log(`registrations   : ${registrationsFile}`);
  console.log(`active stock    : ${activeStockMap.size > 0 ? activeStockFile : '(not provided)'}`);
  console.log(
    `registration cov: ${matchedRegistrationCount}/${listingRows.length}` +
    `${registrationCoverage != null ? ` (${registrationCoverage}%)` : ''}` +
    (
      registrationMinYear != null && registrationMaxYear != null
        ? `, denominator years ${registrationMinYear}-${registrationMaxYear}`
        : ''
    ),
  );
  console.log(
    `main sample    : ${mainRegressionRows.length}/${listingRows.length}` +
    `${mainRegressionCoverage != null ? ` (${mainRegressionCoverage}%)` : ''}` +
    ` with non-null registrations`,
  );
  console.log(`missing regs    : ${path.join(outputDir, 'vehicle_listing_missing_registrations.csv')}`);
  console.log(`output dir      : ${outputDir}`);
}

run().catch((error: unknown) => {
  console.error('[research-vehicles-cz/build-analysis-dataset] fatal error:', error);
  process.exit(1);
});
