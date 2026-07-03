import { promises as fs } from 'fs';
import path from 'path';
import { enrichVehicleListing } from './vehicle-enrichment.js';

interface StoredVehicleRecord {
  source: string;
  id: string;
  title: string;
  description: string | null;
  price?: number | null;
  sellerName?: string | null;
  location?: string | null;
  rawMetadata?: Record<string, unknown> | null;
  url?: string;
  query: {
    brand: string;
    model: string | null;
    query: string;
  };
  enrichment: {
    normalizedBrand: string | null;
    normalizedModel: string | null;
    yearOrigin: number | null;
    yearOriginSource: string;
    yearOriginConfidence: number;
    mileageKm: number | null;
  };
}

const argv = process.argv.slice(2);

function flagValue(flag: string, fallback: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
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

async function readJsonl(file: string): Promise<StoredVehicleRecord[]> {
  const raw = await fs.readFile(file, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StoredVehicleRecord);
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function csvEscape(value: string | number | null): string {
  if (value == null) return '';
  const text = String(value);
  if (!/[,"\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function run(): Promise<void> {
  const inputDir = flagValue('--input-dir', path.join(process.cwd(), 'data'));
  const inputFile = flagValue('--file', '') || await latestJsonl(inputDir);
  const outputDir = flagValue('--output-dir', path.join(process.cwd(), 'data', 'audit'));
  const sampleSize = Number(flagValue('--size', '100')) || 100;
  const priceMin = Number(flagValue('--price-min', '0')) || 0;
  const sources = new Set(
    flagValue('--sources', 'tipcars,bazos,sbazar')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const records = await readJsonl(inputFile);
  const eligible = records.filter((record) => {
    if (!sources.has(record.source)) return false;
    if (priceMin > 0 && (record.price == null || record.price < priceMin)) return false;
    const refreshed = enrichVehicleListing(
      {
        title: record.title,
        description: record.description,
        sellerName: record.sellerName ?? null,
        location: record.location ?? null,
        rawMetadata: record.rawMetadata ?? {},
      } as never,
      record.query.brand,
      record.query.model,
    );
    return refreshed.listingKind === 'vehicle' && (refreshed.normalizedBrand || refreshed.yearOrigin);
  });
  const sample = shuffle(eligible).slice(0, sampleSize);

  await fs.mkdir(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, 'manual_audit_sample.csv');
  const headers = [
    'source',
    'listing_id',
    'url',
    'query_brand',
    'query_model',
    'title',
    'description',
    'extracted_brand',
    'extracted_model',
    'extracted_year',
    'year_source',
    'year_confidence',
    'extracted_mileage_km',
    'review_brand_correct',
    'review_model_correct',
    'review_year_correct',
    'review_notes',
  ];

  const lines = [
    headers.join(','),
    ...sample.map((record) => {
      const refreshed = enrichVehicleListing(
        {
          title: record.title,
          description: record.description,
          sellerName: record.sellerName ?? null,
          location: record.location ?? null,
          rawMetadata: record.rawMetadata ?? {},
        } as never,
        record.query.brand,
        record.query.model,
      );
      return [
      record.source,
      record.id,
      record.url ?? '',
      record.query.brand,
      record.query.model ?? '',
      record.title,
      record.description ?? '',
      refreshed.normalizedBrand ?? '',
      refreshed.normalizedModel ?? '',
      refreshed.yearOrigin ?? '',
      refreshed.yearOriginSource,
      refreshed.yearOriginConfidence,
      refreshed.mileageKm ?? '',
      '',
      '',
      '',
      '',
    ].map((value) => csvEscape(value as string | number | null)).join(',');
    }),
  ];

  await fs.writeFile(outputFile, `${lines.join('\n')}\n`, 'utf8');

  console.log('━━━ Vehicle manual audit sample ━━━');
  console.log(`input          : ${inputFile}`);
  console.log(`eligible       : ${eligible.length}`);
  console.log(`sample size    : ${sample.length}`);
  console.log(`sources        : ${[...sources].join(', ')}`);
  console.log(`price-min      : ${priceMin || 'none'}`);
  console.log(`output         : ${outputFile}`);
}

run().catch((error: unknown) => {
  console.error('[research-vehicles-cz/sample-audit] fatal error:', error);
  process.exit(1);
});
