/**
 * Snapshot persistence for the Czech passenger-vehicle study.
 *
 * The full listing payload is preserved together with typed enrichment so the
 * paper analysis can iterate on model harmonisation, year extraction and defect
 * dictionaries without re-scraping.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getPostgresPool } from '@sdf/platform';
import type { NormalizedListing } from '@sdf/types';
import type { VehicleHarvestQuery } from './query-matrix.js';
import type { VehicleEnrichment } from './vehicle-enrichment.js';

export interface HarvestRecord {
  listing: NormalizedListing;
  query: VehicleHarvestQuery;
  enrichment: VehicleEnrichment;
}

export interface SaveResult {
  persisted: number;
  sink: 'postgres' | 'jsonl';
  location: string;
}

const TABLE = 'cz_vehicle_listings_snapshot';
let tableReady = false;

const COLS = [
  'harvest_batch', 'captured_at', 'market', 'query_kind', 'query_brand', 'query_model', 'query_text',
  'source', 'source_listing_id', 'id', 'url', 'title', 'description', 'price', 'currency',
  'location', 'posted_at', 'condition_text', 'condition', 'image_count', 'image_url',
  'seller_name', 'seller_rating', 'seller_review_count', 'views', 'likes', 'promoted',
  'normalized_brand', 'normalized_model', 'listing_kind', 'year_origin', 'year_origin_source',
  'year_origin_confidence', 'mileage_km', 'vin', 'fuel_type', 'transmission', 'body_type', 'seller_type',
  'flags', 'raw_metadata', 'enrichment',
] as const;

async function ensureTable(): Promise<boolean> {
  const pool = getPostgresPool();
  if (!pool) return false;
  if (tableReady) return true;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      harvest_batch           TEXT NOT NULL,
      captured_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      market                  TEXT NOT NULL,
      query_kind              TEXT NOT NULL,
      query_brand             TEXT NOT NULL,
      query_model             TEXT,
      query_text              TEXT NOT NULL,
      source                  TEXT NOT NULL,
      source_listing_id       TEXT NOT NULL,
      id                      TEXT NOT NULL,
      url                     TEXT,
      title                   TEXT,
      description             TEXT,
      price                   NUMERIC,
      currency                TEXT,
      location                TEXT,
      posted_at               TIMESTAMPTZ,
      condition_text          TEXT,
      condition               TEXT,
      image_count             INTEGER,
      image_url               TEXT,
      seller_name             TEXT,
      seller_rating           NUMERIC,
      seller_review_count     INTEGER,
      views                   INTEGER,
      likes                   INTEGER,
      promoted                BOOLEAN,
      normalized_brand        TEXT,
      normalized_model        TEXT,
      listing_kind            TEXT,
      year_origin             INTEGER,
      year_origin_source      TEXT,
      year_origin_confidence  NUMERIC,
      mileage_km              INTEGER,
      vin                     TEXT,
      fuel_type               TEXT,
      transmission            TEXT,
      body_type               TEXT,
      seller_type             TEXT,
      flags                   JSONB,
      raw_metadata            JSONB,
      enrichment              JSONB,
      PRIMARY KEY (harvest_batch, id)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_brand_age_idx ON ${TABLE} (normalized_brand, year_origin, mileage_km)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_query_idx ON ${TABLE} (harvest_batch, query_brand, query_model, query_kind)`,
  );

  tableReady = true;
  return true;
}

function rowValues(batchId: string, capturedAt: string, record: HarvestRecord): unknown[] {
  const listing = record.listing;
  const enrichment = record.enrichment;

  return [
    batchId,
    capturedAt,
    record.query.market,
    record.query.kind,
    record.query.brand,
    record.query.model,
    record.query.query,
    listing.source,
    listing.sourceListingId,
    listing.id,
    listing.url,
    listing.title,
    listing.description,
    listing.price,
    listing.currency,
    listing.location,
    listing.postedAt ? new Date(listing.postedAt).toISOString() : null,
    listing.conditionText,
    listing.condition,
    listing.imageCount,
    listing.imageUrl,
    listing.sellerName,
    listing.sellerRating,
    listing.sellerReviewCount,
    listing.views,
    listing.likes,
    listing.promoted,
    enrichment.normalizedBrand,
    enrichment.normalizedModel,
    enrichment.listingKind,
    enrichment.yearOrigin,
    enrichment.yearOriginSource,
    enrichment.yearOriginConfidence,
    enrichment.mileageKm,
    enrichment.vin,
    enrichment.fuelType,
    enrichment.transmission,
    enrichment.bodyType,
    enrichment.sellerType,
    JSON.stringify(enrichment.flags),
    JSON.stringify(listing.rawMetadata ?? {}),
    JSON.stringify(enrichment),
  ];
}

async function savePostgres(batchId: string, records: HarvestRecord[]): Promise<SaveResult> {
  const pool = getPostgresPool();
  if (!pool) throw new Error('Postgres is not configured');

  const capturedAt = new Date().toISOString();
  const chunkSize = 150;
  let persisted = 0;

  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);
    const params: unknown[] = [];
    const rows: string[] = [];

    for (const record of chunk) {
      const values = rowValues(batchId, capturedAt, record);
      const base = params.length;
      const placeholders = values.map((_, valueIndex) => {
        const position = base + valueIndex + 1;
        const isJson =
          valueIndex === values.length - 1 ||
          valueIndex === values.length - 2 ||
          valueIndex === values.length - 3;

        return isJson ? `$${position}::jsonb` : `$${position}`;
      });
      rows.push(`(${placeholders.join(',')})`);
      params.push(...values);
    }

    const sql =
      `INSERT INTO ${TABLE} (${COLS.join(',')}) VALUES ${rows.join(',')} ` +
      `ON CONFLICT (harvest_batch, id) DO NOTHING`;
    const result = await pool.query(sql, params);
    persisted += result.rowCount ?? 0;
  }

  return { persisted, sink: 'postgres', location: TABLE };
}

async function saveJsonl(batchId: string, records: HarvestRecord[]): Promise<SaveResult> {
  const dir = process.env.HARVEST_OUT_DIR ?? path.join(process.cwd(), 'data');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${batchId}.jsonl`);
  const capturedAt = new Date().toISOString();

  const lines = records
    .map((record) =>
      JSON.stringify({
        batchId,
        capturedAt,
        query: record.query,
        enrichment: record.enrichment,
        ...record.listing,
      }),
    )
    .join('\n') + '\n';

  await fs.appendFile(file, lines, 'utf8');
  return { persisted: records.length, sink: 'jsonl', location: file };
}

export async function saveBatch(batchId: string, records: HarvestRecord[]): Promise<SaveResult> {
  if (records.length === 0) {
    return { persisted: 0, sink: getPostgresPool() ? 'postgres' : 'jsonl', location: '(empty)' };
  }

  const ready = await ensureTable();
  return ready ? savePostgres(batchId, records) : saveJsonl(batchId, records);
}
