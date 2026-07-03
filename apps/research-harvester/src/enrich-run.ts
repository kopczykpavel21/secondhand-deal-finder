/**
 * Enrichment runner — reads a harvest JSONL file, applies the enrichment pipeline,
 * and writes a PII-free enriched JSONL (sellerName dropped).
 *
 * Usage:
 *   npm run enrich --workspace=apps/research-harvester
 *   tsx src/enrich-run.ts --input data/harvest_2026-06-23_08fab6d7.jsonl
 *   tsx src/enrich-run.ts --input data/harvest_*.jsonl --out-dir data/enriched/
 *
 * Defaults:
 *   --input     latest *.jsonl in HARVEST_OUT_DIR (./data) that is not already enriched
 *   --out-dir   HARVEST_OUT_DIR/enriched/
 */

import { promises as fs } from 'fs';
import path from 'path';
import { enrichListing, type RawHarvestRecord, type FunctionalStatus } from './enrich.js';

// U+2028/U+2029 are valid unescaped in ES2019 JSON strings but Node.js readline
// treats them as line terminators, breaking JSONL parsing on older snapshots.
// Pre-process the file content to escape them before splitting on newlines.
function jsonlSafeLines(raw: string): string[] {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 0x2028) { out += '\\u2028'; continue; }
    if (c === 0x2029) { out += '\\u2029'; continue; }
    out += raw[i];
  }
  return out.split('\n').filter((l) => l.trim());
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flagValue = (f: string, fallback: string): string => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const harvestDir = process.env.HARVEST_OUT_DIR ?? path.join(process.cwd(), 'data');
const inputArg = flagValue('--input', '');
const outDirArg = flagValue('--out-dir', path.join(harvestDir, 'enriched'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findLatestJsonl(dir: string): Promise<string> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const candidates = files
    .filter((f) => f.endsWith('.jsonl') && f.startsWith('harvest_'))
    .sort()
    .reverse();
  if (candidates.length === 0) throw new Error(`No harvest_*.jsonl files found in ${dir}`);
  return path.join(dir, candidates[0]);
}

function pct(n: number, d: number): string {
  return d === 0 ? '0.0' : ((n / d) * 100).toFixed(1);
}

// ─── Per-file enrichment ──────────────────────────────────────────────────────

interface EnrichStats {
  total: number;
  relevant: number;
  brandFound: number;
  ageKnown: number;
  energyBanded: number;
  statusByValue: Record<FunctionalStatus | 'unknown', number>;
  sourceCounts: Record<string, number>;
  marketCounts: Record<string, number>;
}

async function enrichFile(inputPath: string, outDir: string): Promise<EnrichStats> {
  const batchName = path.basename(inputPath, '.jsonl');
  const outPath = path.join(outDir, `enriched_${batchName}.jsonl`);

  await fs.mkdir(outDir, { recursive: true });

  const rawContent = await fs.readFile(inputPath, 'utf8');
  const inputLines = jsonlSafeLines(rawContent);

  const stats: EnrichStats = {
    total: 0, relevant: 0, brandFound: 0, ageKnown: 0, energyBanded: 0,
    statusByValue: { working: 0, degraded: 0, broken: 0, unknown: 0 },
    sourceCounts: {}, marketCounts: {},
  };

  const lines: string[] = [];
  for (const line of inputLines) {
    const raw: RawHarvestRecord = JSON.parse(line);
    const enriched = enrichListing(raw);

    stats.total++;
    if (enriched.isRelevant) stats.relevant++;
    if (enriched.brandParsed) stats.brandFound++;
    if (enriched.ageYearsStated != null || enriched.ageBandFinal != null) stats.ageKnown++;
    if (enriched.ageBandEnergy != null) stats.energyBanded++;

    const st = enriched.functionalStatus ?? 'unknown';
    stats.statusByValue[st] = (stats.statusByValue[st] ?? 0) + 1;
    stats.sourceCounts[enriched.source] = (stats.sourceCounts[enriched.source] ?? 0) + 1;
    stats.marketCounts[enriched.market] = (stats.marketCounts[enriched.market] ?? 0) + 1;

    lines.push(JSON.stringify(enriched));
  }

  await fs.writeFile(outPath, lines.join('\n') + '\n', 'utf8');

  console.log(`\n━━━ Enrichment: ${batchName} ━━━`);
  console.log(`input          : ${inputPath}`);
  console.log(`output         : ${outPath}`);
  console.log(`total          : ${stats.total}`);
  console.log(`relevant       : ${stats.relevant} (${pct(stats.relevant, stats.total)}%)`);
  console.log(`brand parsed   : ${stats.brandFound} (${pct(stats.brandFound, stats.total)}%)`);
  console.log(`age known      : ${stats.ageKnown} (${pct(stats.ageKnown, stats.total)}%)`);
  console.log(`energy banded  : ${stats.energyBanded} (${pct(stats.energyBanded, stats.total)}%)`);
  console.log(`status — working:${stats.statusByValue.working}  degraded:${stats.statusByValue.degraded}  broken:${stats.statusByValue.broken}  unknown:${stats.statusByValue.unknown}`);
  console.log(`by source      : ${Object.entries(stats.sourceCounts).map(([s, n]) => `${s}:${n}`).join(', ')}`);
  console.log(`by market      : ${Object.entries(stats.marketCounts).map(([m, n]) => `${m}:${n}`).join(', ')}`);

  return stats;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const inputPath = inputArg || (await findLatestJsonl(harvestDir));
  console.log(`Enriching: ${inputPath}`);
  await enrichFile(inputPath, outDirArg);
  console.log('\nDone. Run pilot-analysis to see BDP signals.');
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[enrich-run] fatal:', e);
    process.exit(1);
  });
