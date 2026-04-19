import { NextRequest, NextResponse } from 'next/server';

export interface FeedbackEntry {
  id: string;
  submittedAt: string;
  rating: number;
  improvements: string[];
  comment: string | null;
  email: string | null;
}

// In-memory store — survives until the next deploy/restart.
// Each entry is also printed to stdout so Railway's log history keeps them.
const responses: FeedbackEntry[] = [];

// POST /api/feedback
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      rating?: unknown;
      improvements?: unknown;
      comment?: unknown;
      email?: unknown;
    };

    const rating = typeof body.rating === 'number' && body.rating >= 1 && body.rating <= 5
      ? body.rating
      : null;
    if (!rating) {
      return NextResponse.json({ error: 'rating is required (1–5)' }, { status: 400 });
    }

    const improvements = Array.isArray(body.improvements)
      ? (body.improvements as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 10)
      : [];

    const comment = typeof body.comment === 'string' && body.comment.trim().length > 0
      ? body.comment.trim().slice(0, 2000)
      : null;

    const email = typeof body.email === 'string' && body.email.includes('@')
      ? body.email.trim().slice(0, 200)
      : null;

    const entry: FeedbackEntry = {
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      submittedAt: new Date().toISOString(),
      rating,
      improvements,
      comment,
      email,
    };

    responses.push(entry);

    // Log to stdout — visible in Railway's log history even after restarts
    console.log('[feedback]', JSON.stringify(entry));

    return NextResponse.json({ ok: true, id: entry.id });
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
}

// GET /api/feedback — returns all in-memory responses (used by admin page)
export async function GET() {
  const avg = responses.length > 0
    ? (responses.reduce((s, r) => s + r.rating, 0) / responses.length).toFixed(1)
    : null;

  return NextResponse.json({
    total: responses.length,
    averageRating: avg,
    responses: [...responses].reverse(), // newest first
  });
}
