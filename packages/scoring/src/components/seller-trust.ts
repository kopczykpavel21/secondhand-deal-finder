/**
 * Seller trust score.
 *
 * Inputs:
 *  - sellerRating (0–5 scale, normalised if different scale detected)
 *  - sellerReviewCount
 *
 * When neither is available the score is neutral (0.5) — we cannot penalise
 * a listing for a platform not exposing seller stats.
 */

export function scoreSellerTrust(
  rating: number | null,
  reviewCount: number | null,
): number {
  if (rating === null && reviewCount === null) return 0.5;

  let score = 0.5;

  if (rating !== null) {
    // Normalise to 0–5 range if needed (some platforms use 0–10 or 0–100)
    const normalised = rating > 5 ? (rating / 100) * 5 : rating;
    score = normalised / 5;
  }

  if (reviewCount !== null && reviewCount > 0) {
    // Volume confidence: 0 reviews → 0, 10+ reviews → 1.0 boost factor
    const volumeFactor = Math.min(1, reviewCount / 10);
    // Blend: high rating + many reviews = more trust
    score = score * (0.6 + 0.4 * volumeFactor);
  }

  return Math.min(1, Math.max(0, score));
}
