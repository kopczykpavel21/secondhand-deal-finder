import { promises as fs } from 'fs';
import path from 'path';
import type { VehicleEnrichment } from './vehicle-enrichment.js';

interface StoredVehicleRecord {
  batchId: string;
  capturedAt: string;
  source: string;
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  currency: string;
  query: {
    kind: string;
    brand: string;
    model: string | null;
    query: string;
  };
  enrichment: VehicleEnrichment;
}

interface BrandAccumulator {
  count: number;
  prices: number[];
  mileages: number[];
  defectCount: number;
  older15Count: number;
}

const argv = process.argv.slice(2);

function flagValue(flag: string, fallback: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function ageBand(yearOrigin: number | null): string {
  if (!yearOrigin) return 'unknown';
  const age = new Date().getFullYear() - yearOrigin;
  if (age < 5) return '0-4';
  if (age < 10) return '5-9';
  if (age < 15) return '10-14';
  if (age < 20) return '15-19';
  return '20+';
}

function hasSeriousDefect(enrichment: VehicleEnrichment): boolean {
  const flags = enrichment.flags;
  return flags.repairNeeded || flags.accidentDamaged || flags.engineIssue || flags.transmissionIssue || flags.rustIssue;
}

async function readJsonlRecords(file: string): Promise<StoredVehicleRecord[]> {
  const raw = await fs.readFile(file, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StoredVehicleRecord);
}

async function latestJsonl(dir: string): Promise<string> {
  const entries = await fs.readdir(dir);
  const files = entries.filter((entry) => entry.endsWith('.jsonl'));
  if (files.length === 0) {
    throw new Error(`No JSONL files found in ${dir}`);
  }
  const withStats = await Promise.all(
    files.map(async (file) => {
      const fullPath = path.join(dir, file);
      const stat = await fs.stat(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    }),
  );
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withStats[0].fullPath;
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

async function run(): Promise<void> {
  const inputDir = flagValue('--input-dir', path.join(process.cwd(), 'data'));
  const outputDir = flagValue('--output-dir', path.join(process.cwd(), 'data', 'derived'));
  const fileArg = flagValue('--file', '');
  const inputFile = fileArg || await latestJsonl(inputDir);
  const records = await readJsonlRecords(inputFile);

  const brandAgeRows: Array<Record<string, string | number | null>> = [];
  const brandAgeCounts = new Map<string, number>();
  const brandSummary = new Map<string, BrandAccumulator>();
  const brandModelAgeCounts = new Map<string, number>();

  for (const record of records) {
    const brand = record.enrichment.normalizedBrand ?? record.query.brand;
    const model = record.enrichment.normalizedModel ?? record.query.model ?? 'unknown';
    const band = ageBand(record.enrichment.yearOrigin);

    const brandAgeKey = `${brand}|||${band}`;
    brandAgeCounts.set(brandAgeKey, (brandAgeCounts.get(brandAgeKey) ?? 0) + 1);

    const brandModelAgeKey = `${brand}|||${model}|||${band}`;
    brandModelAgeCounts.set(brandModelAgeKey, (brandModelAgeCounts.get(brandModelAgeKey) ?? 0) + 1);

    const bucket = brandSummary.get(brand) ?? {
      count: 0,
      prices: [],
      mileages: [],
      defectCount: 0,
      older15Count: 0,
    };

    bucket.count += 1;
    if (typeof record.price === 'number') bucket.prices.push(record.price);
    if (typeof record.enrichment.mileageKm === 'number') bucket.mileages.push(record.enrichment.mileageKm);
    if (hasSeriousDefect(record.enrichment)) bucket.defectCount += 1;
    if (band === '15-19' || band === '20+') bucket.older15Count += 1;
    brandSummary.set(brand, bucket);
  }

  for (const [key, count] of brandAgeCounts.entries()) {
    const [brand, band] = key.split('|||');
    brandAgeRows.push({ brand, age_band: band, listing_count: count });
  }

  const brandPriceRows = [...brandSummary.entries()]
    .map(([brand, bucket]) => ({
      brand,
      listing_count: bucket.count,
      older_15_plus_count: bucket.older15Count,
      median_price_czk: median(bucket.prices),
      median_mileage_km: median(bucket.mileages),
      serious_defect_rate: bucket.count > 0 ? Number((bucket.defectCount / bucket.count).toFixed(4)) : null,
    }))
    .sort((a, b) => Number(b.listing_count) - Number(a.listing_count));

  const defectRows = [...brandSummary.entries()]
    .map(([brand, bucket]) => ({
      brand,
      listing_count: bucket.count,
      serious_defect_count: bucket.defectCount,
      serious_defect_rate: bucket.count > 0 ? Number((bucket.defectCount / bucket.count).toFixed(4)) : null,
    }))
    .sort((a, b) => Number(b.serious_defect_rate ?? 0) - Number(a.serious_defect_rate ?? 0));

  const brandModelAgeRows = [...brandModelAgeCounts.entries()]
    .map(([key, count]) => {
      const [brand, model, band] = key.split('|||');
      return { brand, model, age_band: band, listing_count: count };
    })
    .sort((a, b) => Number(b.listing_count) - Number(a.listing_count));

  await fs.mkdir(outputDir, { recursive: true });
  await writeCsv(path.join(outputDir, 'brand_age_counts.csv'), brandAgeRows);
  await writeCsv(path.join(outputDir, 'brand_price_summary.csv'), brandPriceRows);
  await writeCsv(path.join(outputDir, 'brand_defect_rates.csv'), defectRows);
  await writeCsv(path.join(outputDir, 'brand_model_age_counts.csv'), brandModelAgeRows);

  console.log('━━━ Vehicle analysis export ━━━');
  console.log(`input          : ${inputFile}`);
  console.log(`records        : ${records.length}`);
  console.log(`output dir     : ${outputDir}`);
  console.log('files          : brand_age_counts.csv, brand_price_summary.csv, brand_defect_rates.csv, brand_model_age_counts.csv');
}

run().catch((error: unknown) => {
  console.error('[research-vehicles-cz/analyze] fatal error:', error);
  process.exit(1);
});
