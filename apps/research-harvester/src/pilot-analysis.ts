/**
 * Pilot BDP signal analysis — face-validity check for the durability proxy.
 *
 * Reads the enriched JSONL (output of enrich-run) and prints a brand-level table
 * with three signals:
 *
 *   S1 — functional-survival ratio: working / (working + broken) per brand
 *        (within-brand, self-normalises for market share)
 *   S3 — survival-tail: share of listings in the 'old' vintage band
 *        (confounded by original sales volume; treat as corroborating only)
 *   n  — listing count, price stats
 *
 * Face-validity expectation: premium brands (Miele, Bosch, AEG) > budget brands
 * (Candy, Indesit) on S1. If this holds before external validation, the signal exists.
 *
 * Usage:
 *   npm run pilot-analysis --workspace=apps/research-harvester
 *   tsx src/pilot-analysis.ts [--input data/enriched/enriched_harvest_*.jsonl]
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { EnrichedListing } from './enrich.js';

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
const enrichedDir = path.join(harvestDir, 'enriched');
const inputArg = flagValue('--input', '');

async function findLatestEnriched(dir: string): Promise<string> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const candidates = files
    .filter((f) => f.startsWith('enriched_harvest_') && f.endsWith('.jsonl'))
    .sort()
    .reverse();
  if (candidates.length === 0) throw new Error(`No enriched_harvest_*.jsonl in ${dir}. Run enrich first.`);
  return path.join(dir, candidates[0]);
}

// ─── Per-brand accumulators ───────────────────────────────────────────────────

interface BrandStats {
  brand: string;
  n: number;
  nRelevant: number;
  nWorking: number;
  nDegraded: number;
  nBroken: number;
  nStatusKnown: number;
  nOld: number;       // ageBandFinal === 'old'
  nRecent: number;    // ageBandFinal === 'recent'
  nAgeBanded: number;
  prices: number[];   // priceEur, only relevant listings
  nCz: number;
  nDe: number;
}

function blankStats(brand: string): BrandStats {
  return {
    brand, n: 0, nRelevant: 0,
    nWorking: 0, nDegraded: 0, nBroken: 0, nStatusKnown: 0,
    nOld: 0, nRecent: 0, nAgeBanded: 0,
    prices: [], nCz: 0, nDe: 0,
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function pctStr(n: number, d: number): string {
  if (d === 0) return '  —  ';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function medianStr(arr: number[]): string {
  if (arr.length === 0) return '  —  ';
  const sorted = [...arr].sort((a, b) => a - b);
  const m = sorted[Math.floor(sorted.length / 2)];
  return `€${Math.round(m)}`;
}

function padL(s: string, w: number): string {
  return s.padStart(w);
}

function padR(s: string, w: number): string {
  return s.padEnd(w);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const inputPath = inputArg || (await findLatestEnriched(enrichedDir));
  console.log(`Reading: ${inputPath}\n`);

  const byBrand = new Map<string, BrandStats>();
  const globalStats = { total: 0, relevant: 0, noBrand: 0, noStatus: 0, noAge: 0 };

  const rawContent = await fs.readFile(inputPath, 'utf8');
  const inputLines = jsonlSafeLines(rawContent);

  for (const line of inputLines) {
    const e: EnrichedListing = JSON.parse(line);
    globalStats.total++;
    if (!e.isRelevant) continue;
    globalStats.relevant++;

    const brand = e.brandParsed ?? '(unmatched)';
    if (!byBrand.has(brand)) byBrand.set(brand, blankStats(brand));
    const s = byBrand.get(brand)!;

    s.n++;
    if (e.market === 'cz') s.nCz++; else s.nDe++;
    if (e.priceEur != null) s.prices.push(e.priceEur);

    if (e.functionalStatus === 'working') { s.nWorking++; s.nStatusKnown++; }
    else if (e.functionalStatus === 'degraded') { s.nDegraded++; s.nStatusKnown++; }
    else if (e.functionalStatus === 'broken') { s.nBroken++; s.nStatusKnown++; }
    else globalStats.noStatus++;

    if (e.ageBandFinal === 'old') { s.nOld++; s.nAgeBanded++; }
    else if (e.ageBandFinal === 'recent') { s.nRecent++; s.nAgeBanded++; }
    else globalStats.noAge++;

    if (!e.brandParsed) globalStats.noBrand++;
  }

  // Sort by listing count descending, unmatch at bottom
  const rows = [...byBrand.values()]
    .filter((s) => s.brand !== '(unmatched)')
    .sort((a, b) => b.n - a.n);
  const unmatched = byBrand.get('(unmatched)');

  // Compute S1 for sorting — working / (working + broken)
  const s1 = (s: BrandStats): number =>
    s.nWorking + s.nBroken > 0 ? s.nWorking / (s.nWorking + s.nBroken) : 0;

  const byS1 = [...rows].sort((a, b) => s1(b) - s1(a));

  // ─── Print tables ─────────────────────────────────────────────────────────

  const SEP = '─'.repeat(90);

  console.log('━━━ Pilot BDP signals — face-validity check ━━━');
  console.log(`Source: ${path.basename(inputPath)}`);
  console.log(`Total harvested: ${globalStats.total}  |  relevant: ${globalStats.relevant}\n`);

  // Table 1: ranked by S1 (functional-survival ratio)
  console.log('── S1 ranking: functional-survival ratio (working / working+broken) ──');
  console.log(SEP);
  console.log(
    padR('Brand', 14) +
    padL('n', 6) +
    padL('S1', 9) +
    padL('working%', 10) +
    padL('broken%', 9) +
    padL('S3_old%', 9) +
    padL('med.EUR', 9) +
    padL('CZ', 6) +
    padL('DE', 6),
  );
  console.log(SEP);
  for (const s of byS1) {
    const statusBase = s.nWorking + s.nBroken; // S1 denominator excludes degraded
    const s1Val = statusBase > 0 ? `${((s.nWorking / statusBase) * 100).toFixed(1)}%` : '  —  ';
    console.log(
      padR(s.brand, 14) +
      padL(String(s.n), 6) +
      padL(s1Val, 9) +
      padL(pctStr(s.nWorking, s.nStatusKnown), 10) +
      padL(pctStr(s.nBroken, s.nStatusKnown), 9) +
      padL(pctStr(s.nOld, s.nAgeBanded), 9) +
      padL(medianStr(s.prices), 9) +
      padL(String(s.nCz), 6) +
      padL(String(s.nDe), 6),
    );
  }
  console.log(SEP);
  if (unmatched) {
    console.log(
      padR('(unmatched)', 14) +
      padL(String(unmatched.n), 6) +
      padL('  —  ', 9),
    );
  }

  // Table 2: listing count by brand × market
  console.log('\n── By market ──');
  console.log(padR('Brand', 14) + padL('CZ', 8) + padL('DE', 8) + padL('total', 8));
  console.log('─'.repeat(38));
  for (const s of rows) {
    console.log(padR(s.brand, 14) + padL(String(s.nCz), 8) + padL(String(s.nDe), 8) + padL(String(s.n), 8));
  }

  // Coverage summary
  console.log('\n── Parser coverage ──');
  console.log(`Brand parsed   : ${pctStr(globalStats.relevant - (unmatched?.n ?? 0), globalStats.relevant)}`);
  console.log(`Status known   : ${pctStr(globalStats.relevant - globalStats.noStatus, globalStats.relevant)}`);
  console.log(`Age banded     : ${pctStr(globalStats.relevant - globalStats.noAge, globalStats.relevant)}`);

  // Spearman placeholder note
  console.log('\n── Next step ──');
  console.log('S2 (residual-value retention) requires the hedonic regression (Python/R notebook).');
  console.log('External validation: ORDS fault rates → Spearman ρ(BDP, ORDS) + bootstrap CIs.');
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[pilot-analysis] fatal:', e);
    process.exit(1);
  });
