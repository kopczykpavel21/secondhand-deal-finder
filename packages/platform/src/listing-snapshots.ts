/**
 * Price-history snapshots — one row per listing per day (same dedupe pattern
 * as QualityDB's product_snapshots). Written opportunistically from search
 * results, so no extra scraping is needed; history accumulates for anything
 * that appears in searches.
 *
 * No-ops gracefully when DATABASE_URL is not configured.
 */
import type { PriceChange, ScoredListing } from '@sdf/types';
import { getPostgresPool } from './postgres.js';

let snapshotTableReady = false;

async function ensureSnapshotTable(): Promise<boolean> {
  const pool = getPostgresPool();
  if (!pool) return false;
  if (snapshotTableReady) return true;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_snapshots (
      source TEXT NOT NULL,
      source_listing_id TEXT NOT NULL,
      price NUMERIC NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CZK',
      seen_on DATE NOT NULL DEFAULT CURRENT_DATE,
      seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (source, source_listing_id, seen_on)
    )
  `);
  snapshotTableReady = true;
  return true;
}

/**
 * Records today's price for each priced listing (upsert — the last price
 * observed on a given day wins). Errors are logged, never thrown: snapshot
 * recording must never break a search.
 */
export async function recordListingSnapshots(listings: ScoredListing[]): Promise<void> {
  try {
    if (!(await ensureSnapshotTable())) return;
    const pool = getPostgresPool();
    if (!pool) return;

    // Dedupe by source+id — a duplicate conflict target in one multi-row
    // INSERT would raise "ON CONFLICT DO UPDATE cannot affect row a second time".
    const seen = new Set<string>();
    const priced = listings.filter((l) => {
      if (l.price === null || l.price <= 0) return false;
      const key = `${l.source}:${l.sourceListingId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (priced.length === 0) return;

    // Single multi-row upsert
    const values: unknown[] = [];
    const rows = priced.map((l, i) => {
      values.push(l.source, l.sourceListingId, l.price, l.currency);
      const o = i * 4;
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4})`;
    });

    await pool.query(
      `
        INSERT INTO listing_snapshots (source, source_listing_id, price, currency)
        VALUES ${rows.join(', ')}
        ON CONFLICT (source, source_listing_id, seen_on)
        DO UPDATE SET price = EXCLUDED.price, seen_at = NOW()
      `,
      values,
    );
  } catch (err) {
    console.error('[snapshots] record failed:', (err as Error).message);
  }
}

interface PreviousPriceRow {
  source: string;
  source_listing_id: string;
  price: string;
  seen_on: string;
}

/**
 * Attaches `priceChange` to listings whose price differs from the most
 * recent snapshot taken on a PREVIOUS day. Mutates and returns the array.
 * Errors are swallowed — annotation is best-effort.
 */
export async function annotatePriceHistory(listings: ScoredListing[]): Promise<ScoredListing[]> {
  try {
    if (!(await ensureSnapshotTable())) return listings;
    const pool = getPostgresPool();
    if (!pool) return listings;

    const priced = listings.filter((l) => l.price !== null && l.price > 0);
    if (priced.length === 0) return listings;

    const values: unknown[] = [];
    const pairs = priced.map((l, i) => {
      values.push(l.source, l.sourceListingId);
      return `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`;
    });

    const result = await pool.query<PreviousPriceRow>(
      `
        SELECT DISTINCT ON (source, source_listing_id)
          source, source_listing_id, price, seen_on::text
        FROM listing_snapshots
        WHERE (source, source_listing_id) IN (${pairs.join(', ')})
          AND seen_on < CURRENT_DATE
        ORDER BY source, source_listing_id, seen_on DESC
      `,
      values,
    );

    const previous = new Map<string, { price: number; seenOn: string }>();
    for (const row of result.rows) {
      previous.set(`${row.source}:${row.source_listing_id}`, {
        price: Number(row.price),
        seenOn: row.seen_on,
      });
    }

    for (const listing of priced) {
      const prev = previous.get(`${listing.source}:${listing.sourceListingId}`);
      if (!prev || prev.price <= 0 || listing.price === null) continue;

      const changePct = ((listing.price - prev.price) / prev.price) * 100;
      // Ignore sub-1% noise (currency rounding on converted prices)
      if (Math.abs(changePct) < 1) continue;

      const change: PriceChange = {
        previousPrice: prev.price,
        changePct: Math.round(changePct * 10) / 10,
        observedAt: prev.seenOn,
      };
      listing.priceChange = change;
    }
  } catch (err) {
    console.error('[snapshots] annotate failed:', (err as Error).message);
  }
  return listings;
}
