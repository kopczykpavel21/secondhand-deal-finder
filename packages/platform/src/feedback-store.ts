import { randomUUID } from 'crypto';
import { getPostgresPool } from './postgres';

export interface FeedbackEntry {
  id: string;
  submittedAt: string;
  rating: number;
  improvements: string[];
  comment: string | null;
  email: string | null;
}

interface FeedbackRow {
  id: string;
  submitted_at: string;
  rating: number;
  improvements: string[];
  comment: string | null;
  email: string | null;
}

const memoryFeedback: FeedbackEntry[] = [];
let feedbackTableReady = false;

async function ensureFeedbackTable(): Promise<void> {
  if (feedbackTableReady) return;

  const pool = getPostgresPool();
  if (!pool) {
    feedbackTableReady = true;
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback_entries (
      id TEXT PRIMARY KEY,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      improvements JSONB NOT NULL DEFAULT '[]'::jsonb,
      comment TEXT,
      email TEXT
    )
  `);
  feedbackTableReady = true;
}

export interface SaveFeedbackInput {
  rating: number;
  improvements: string[];
  comment: string | null;
  email: string | null;
}

export async function saveFeedbackEntry(input: SaveFeedbackInput): Promise<FeedbackEntry> {
  await ensureFeedbackTable();

  const entry: FeedbackEntry = {
    id: `fb_${randomUUID()}`,
    submittedAt: new Date().toISOString(),
    rating: input.rating,
    improvements: input.improvements,
    comment: input.comment,
    email: input.email,
  };

  const pool = getPostgresPool();
  if (!pool) {
    memoryFeedback.push(entry);
    return entry;
  }

  await pool.query(
    `
      INSERT INTO feedback_entries (id, submitted_at, rating, improvements, comment, email)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6)
    `,
    [
      entry.id,
      entry.submittedAt,
      entry.rating,
      JSON.stringify(entry.improvements),
      entry.comment,
      entry.email,
    ],
  );

  return entry;
}

export async function listFeedbackEntries(): Promise<FeedbackEntry[]> {
  await ensureFeedbackTable();

  const pool = getPostgresPool();
  if (!pool) {
    return [...memoryFeedback].sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  }

  const result = await pool.query<FeedbackRow>(`
    SELECT id, submitted_at, rating, improvements, comment, email
    FROM feedback_entries
    ORDER BY submitted_at DESC
  `);

  return result.rows.map((row: FeedbackRow) => ({
    id: row.id,
    submittedAt: new Date(row.submitted_at).toISOString(),
    rating: row.rating,
    improvements: Array.isArray(row.improvements) ? row.improvements : [],
    comment: row.comment,
    email: row.email,
  }));
}
