/**
 * Freshness score: how recently was the listing posted?
 *
 * Decay curve:
 *   < 1 hour   → 1.0
 *   1 day      → 0.9
 *   3 days     → 0.75
 *   7 days     → 0.55
 *   14 days    → 0.35
 *   30 days    → 0.15
 *   > 60 days  → 0.05
 *
 * null postedAt → neutral 0.4
 */

const DECAY_POINTS: Array<[number, number]> = [
  [0, 1.0],       // now
  [1, 0.9],       // 1 hour
  [24, 0.80],     // 1 day
  [72, 0.65],     // 3 days
  [168, 0.45],    // 7 days
  [336, 0.25],    // 14 days
  [720, 0.12],    // 30 days
  [1440, 0.05],   // 60 days
];

export function scoreFreshness(postedAt: Date | null): number {
  if (!postedAt) return 0.4;

  const ageHours = (Date.now() - postedAt.getTime()) / 3_600_000;
  if (ageHours < 0) return 0.5; // future date, data issue

  return interpolate(ageHours, DECAY_POINTS);
}

function interpolate(x: number, points: Array<[number, number]>): number {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}
