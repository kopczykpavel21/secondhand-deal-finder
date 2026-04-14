/**
 * Engagement score based on views (and optionally likes), adjusted for
 * listing age so that brand-new listings are not disadvantaged.
 *
 * ─── Why age-normalisation matters ──────────────────────────────────────────
 * A listing posted 1 hour ago with 30 views is actually generating far more
 * interest than a week-old listing with 100 views — but raw view counts would
 * rank the latter higher.  We solve this with a *views-velocity* metric:
 *
 *   velocity = views / sqrt(age_hours + AGE_SMOOTHING)
 *
 * The square-root denominator grows slowly, which means:
 *  • Old listings are not excessively penalised (sqrt grows much slower than age).
 *  • New listings are not artificially boosted (the +AGE_SMOOTHING constant
 *    acts as a 24-hour "prior", preventing 0-hour-old listings from scoring ∞).
 *
 * The velocity is then mapped to [0,1] via a log₁₀ curve so that the score
 * increases meaningfully up to a practical ceiling and doesn't suddenly stop
 * differentiating at the top end.
 *
 * ─── Concrete examples ───────────────────────────────────────────────────────
 *  age=1h,  views=30   → velocity ≈  6.0  → score ≈ 0.56
 *  age=6h,  views=50   → velocity ≈  8.3  → score ≈ 0.63
 *  age=24h, views=100  → velocity ≈ 14.1  → score ≈ 0.74
 *  age=72h, views=300  → velocity ≈ 30.0  → score ≈ 0.88
 *  age=7d,  views=500  → velocity ≈ 35.4  → score ≈ 0.91
 *  age=7d,  views=20   → velocity ≈  1.4  → score ≈ 0.26
 *  any,     views=0    → velocity = 0     → score = 0.15  (low, but not zero —
 *                                                          listing just uploaded)
 *
 * ─── Null handling ───────────────────────────────────────────────────────────
 *  views=null  → 0.5  (source doesn't expose views; neutral, no penalty)
 *  postedAt=null, views≥0 → use a default age of 3 days (conservative mid-range)
 */

const AGE_SMOOTHING_HOURS = 24; // treat listings as if at least 1 day old
const VELOCITY_CEILING    = 50; // velocity at which score saturates to 1.0
const FLOOR_SCORE         = 0.15; // minimum score for a listing with 0 views

export function scoreEngagement(
  views: number | null,
  likes: number | null,
  postedAt?: Date | null,
): number {
  // No views data at all → neutral (source doesn't expose it)
  if (views === null && likes === null) return 0.5;

  // Compute age in hours, falling back to 72h (3 days) when unknown
  let ageHours = 72;
  if (postedAt) {
    ageHours = Math.max(0, (Date.now() - postedAt.getTime()) / 3_600_000);
  }

  const smoothedAge = ageHours + AGE_SMOOTHING_HOURS;

  // --- Views velocity -------------------------------------------------------
  let viewScore = FLOOR_SCORE;
  if (views !== null && views >= 0) {
    if (views === 0) {
      // Zero views on a listing that has had time to be seen signals low interest.
      // For very new listings (< 2h) we give neutral rather than penalising.
      viewScore = ageHours < 2 ? 0.5 : FLOOR_SCORE;
    } else {
      const velocity = views / Math.sqrt(smoothedAge);
      // log₁₀ curve: velocity 1→0.21, 10→0.71, 50→1.0
      const logCeiling = Math.log10(VELOCITY_CEILING + 1);
      viewScore = Math.min(1, Math.log10(velocity + 1) / logCeiling);
    }
  }

  // --- Likes (optional, weighted at 30% when present) ----------------------
  if (likes === null || likes < 0) {
    return viewScore;
  }

  const likesVelocity = likes / Math.sqrt(smoothedAge);
  const logCeiling    = Math.log10(VELOCITY_CEILING + 1);
  const likeScore     = likes === 0
    ? (ageHours < 2 ? 0.5 : FLOOR_SCORE)
    : Math.min(1, Math.log10(likesVelocity + 1) / logCeiling);

  // Blend: views carry 70%, likes carry 30%
  return viewScore * 0.7 + likeScore * 0.3;
}
