/**
 * Snapshot persistence for the harvest.
 *
 * Primary sink: Postgres table `appliance_listings_snapshot` (uses the existing
 * pool from @sdf/platform). Stores the full NormalizedListing plus the query
 * context that surfaced it and the raw adapter metadata as JSONB, so all
 * downstream variables (brand, age, functional status, specs) can be
 * re-derived in enrichment WITHOUT re-scraping.
 *
 * Fallback sink: append-only JSONL on disk, used automatically when
 * DATABASE_URL is not configured — so the harvester is fully runnable (and
 * testable) without a database.
 *
 * PII note: seller_name is retained in the working snapshot only. Any released
 * dataset must aggregate to brand×category and drop/hash seller identifiers
 * (see the study plan, §3 Ethics / GDPR).
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getPostgresPool } from '@sdf/platform';
import type { NormalizedListing } from '@sdf/types';
import type { HarvestMarket } from './query-matrix.js';

export interface HarvestRecord {
  listing: NormalizedListing;
  market: HarvestMarket;
  categoryId: string;
  brandQuery: string | null;
  queryText: string;
}

export interface SaveResult {
  persisted: number;
  sink: 'postgres' | 'jsonl';
  location: string;
}

const TABLE = 'appliance_listings_snapshot';
let tableReady = false;

const COLS = [
  'harvest_batch', 'captured_at', 'market', 'query_category', 'query_brand', 'query_text',
  'source', 'source_listing_id', 'id', 'url', 'title', 'description', 'price', 'currency',
  'location', 'posted_at', 'condition_text', 'condition', 'image_count', 'image_url',
  'seller_name', 'seller_rating', 'seller_review_count', 'views', 'likes', 'promoted',
  'raw_metadata',
] as const;

/**
 * U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) are valid unescaped
 * in JSON strings per ES2019, but Node.js readline treats them as line terminators.
 * Escape them after JSON.stringify so each JSONL record stays on exactly one line.
 */
function jsonlSafe(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x2028) { out += '\\u2028'; continue; }
    if (c === 0x2029) { out += '\\u2029'; continue; }
    out += s[i];
  }
  return out;
}

async function ensureTable(): Promise<boolean> {
  const pool = getPostgresPool();
  if (!pool) return false;
  if (tableReady) return true;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      harvest_batch       TEXT NOT NULL,
      captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      market              TEXT NOT NULL,
      query_category      TEXT NOT NULL,
      query_brand         TEXT,
      query_text          TEXT NOT NULL,
      source              TEXT NOT NULL,
      source_listing_id   TEXT NOT NULL,
      id                  TEXT NOT NULL,
      url                 TEXT,
      title               TEXT,
      description         TEXT,
      price               NUMERIC,
      currency            TEXT,
      location            TEXT,
      posted_at           TIMESTAMPTZ,
      condition_text      TEXT,
      condition           TEXT,
      image_count         INTEGER,
      image_url           TEXT,
      seller_name         TEXT,
      seller_rating       NUMERIC,
      seller_review_count INTEGER,
      views               INTEGER,
      likes               INTEGER,
      promoted            BOOLEAN,
      raw_metadata        JSONB,
      PRIMARY KEY (harvest_batch, id)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_ctx_idx ON ${TABLE} (harvest_batch, market, query_category)`,
  );
  tableReady = true;
  return true;
}

function rowValues(batchId: string, capturedAt: string, r: HarvestRecord): unknown[] {
  const l = r.listing;
  return [
    batchId, capturedAt, r.market, r.categoryId, r.brandQuery, r.queryText,
    l.source, l.sourceListingId, l.id, l.url, l.title, l.description, l.price, l.currency,
    l.location, l.postedAt ? new Date(l.postedAt).toISOString() : null, l.conditionText, l.condition,
    l.imageCount, l.imageUrl, l.sellerName, l.sellerRating, l.sellerReviewCount, l.views, l.likes,
    l.promoted, JSON.stringify(l.rawMetadata ?? {}),
  ];
}

async function savePostgres(batchId: string, records: HarvestRecord[]): Promise<SaveResult> {
  const pool = getPostgresPool()!;
  const capturedAt = new Date().toISOString();
  const CHUNK = 200;
  let persisted = 0;

  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const rows: string[] = [];

    for (const r of chunk) {
      const vals = rowValues(batchId, capturedAt, r);
      const base = params.length;
      const placeholders = vals.map((_, j) => {
        const n = base + j + 1;
        return j === vals.length - 1 ? `$${n}::jsonb` : `$${n}`;
      });
      rows.push(`(${placeholders.join(',')})`);
      params.push(...vals);
    }

    const sql =
      `INSERT INTO ${TABLE} (${COLS.join(',')}) VALUES ${rows.join(',')} ` +
      `ON CONFLICT (harvest_batch, id) DO NOTHING`;
    const res = await pool.query(sql, params);
    persisted += res.rowCount ?? 0;
  }

  return { persisted, sink: 'postgres', location: TABLE };
}

async function saveJsonl(batchId: string, records: HarvestRecord[]): Promise<SaveResult> {
  const dir = process.env.HARVEST_OUT_DIR ?? path.join(process.cwd(), 'data');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${batchId}.jsonl`);
  const capturedAt = new Date().toISOString();

  const lines =
    records
      .map((r) =>
        jsonlSafe(JSON.stringify({
          batchId, capturedAt,
          market: r.market, categoryId: r.categoryId,
          brandQuery: r.brandQuery, queryText: r.queryText,
          ...r.listing,
        })),
      )
      .join('\n') + '\n';

  await fs.appendFile(file, lines, 'utf8');
  return { persisted: records.length, sink: 'jsonl', location: file };
}

/** Persist a batch of harvested records. Routes to Postgres when configured, else JSONL. */
export async function saveBatch(batchId: string, records: HarvestRecord[]): Promise<SaveResult> {
  if (records.length === 0) {
    return { persisted: 0, sink: getPostgresPool() ? 'postgres' : 'jsonl', location: '(empty)' };
  }
  const ready = await ensureTable();
  return ready ? savePostgres(batchId, records) : saveJsonl(batchId, records);
}
