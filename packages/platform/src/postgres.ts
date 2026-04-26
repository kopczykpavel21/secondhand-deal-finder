import { Pool } from 'pg';

let pool: Pool | null = null;

export function isPostgresConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPostgresPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      ssl: process.env.PG_SSL === 'false'
        ? false
        : process.env.DATABASE_URL.includes('localhost')
          ? false
          : { rejectUnauthorized: false },
    });
    pool.on('error', (error) => {
      console.error('[postgres] pool error:', error);
    });
  }

  return pool;
}
