# Secondhand Deal Finder

A production-minded MVP that aggregates secondhand listings from Bazoš, Sbazar, Vinted, and Facebook Marketplace, ranks them by a smart "Best Deal Score", and presents results in a clean, mobile-first UI.

---

## Architecture

```
secondhand-deal-finder/
├── apps/
│   └── web/                        # Next.js 14 frontend + API routes
│       └── src/
│           ├── app/
│           │   ├── page.tsx         # Main search page (client component)
│           │   └── api/search/      # GET /api/search — search coordinator
│           ├── components/          # UI components
│           └── hooks/useSearch.ts   # Search state hook
│
└── packages/
    ├── types/        # Shared TypeScript types (NormalizedListing, ScoredListing…)
    ├── scoring/      # Scoring engine (relevance, value, condition, freshness…)
    ├── core/         # SearchCoordinator, deduplicator, logger
    └── source-adapters/
        ├── base-adapter.ts   # Playwright-based abstract base
        ├── bazos/            # FULL support
        ├── sbazar/           # PARTIAL support
        ├── vinted/           # EXPERIMENTAL
        ├── facebook/         # EXPERIMENTAL (login wall — see below)
        └── mock/             # Development fixtures
```

---

## Source Support Levels

| Source | Support | Signals Available | Promoted Detection |
|--------|---------|-------------------|--------------------|
| **Bazoš** | **full** | title, price, location, date, image | ✅ CSS class detection |
| **Sbazar** | **partial** | title, price, location, date, image, seller name | ✅ data attribute |
| **Vinted** | experimental | title, price, image, seller name | ⚠️ fragile |
| **Facebook** | experimental | title, price (partial) — login wall blocks most | ❌ unreliable |

### Known limitations by source

#### Bazoš
- No seller reputation system — `sellerRating` always `null`.
- Condition is a free-text inference from title, not a structured field.
- "Topovaný" (promoted) detection relies on CSS classes that may change.

#### Sbazar
- Seller ratings do not appear on search result pages.
- Attempts JSON-LD extraction first (more stable); falls back to DOM selectors.

#### Vinted
- Client-rendered (React SPA) — requires Playwright with `waitForSelector`.
- Primarily fashion/clothing — may return few results for non-fashion queries.
- Condition and location only on detail pages (not scraped in MVP).
- Consent banner must be dismissed before grid loads.
- High risk of rate-limiting or blocking if queried frequently.

#### Facebook Marketplace
- **As of 2024, Facebook redirects unauthenticated Marketplace searches to a login wall.**
- This adapter attempts to extract Open Graph / embedded JSON data before the redirect,
  but in practice returns 0 results most of the time.
- **Recommendation:** Replace with a third-party scraping API (Apify, ScraperAPI)
  that handles Facebook auth — the adapter interface is drop-in compatible.

---

## Scoring Engine

The **Best Deal Score** (0–100) is a weighted sum of these components:

| Component | Weight | Description |
|-----------|--------|-------------|
| Relevance | 0.50 | Token overlap between query and title/description |
| Value for money | 0.25 | Price vs. median of same search results |
| Condition | 0.15 | Normalised condition (new → 1.0, poor → 0.15) |
| Freshness | 0.10 | Recency decay curve (< 1h → 1.0, > 60d → 0.05) |
| Completeness | 0.10 | Fraction of listing fields populated |
| Seller trust | 0.10 | Rating × review-count confidence |
| Engagement | 0.05 | Views / likes (neutral 0.5 when unavailable) |
| Promoted penalty | −0.15 | Applied when paid promotion is detected |
| Spam penalty | −0.20 | Applied when phone-number/spam patterns found |

Weights are configurable — export `DEFAULT_WEIGHTS` from `@sdf/scoring` and override.

---

## Quick Start

### Prerequisites
- Node.js ≥ 20
- npm ≥ 10

```bash
# 1. Clone and install
cd secondhand-deal-finder
cp .env.example .env          # USE_MOCK_ADAPTERS=true by default

npm install                    # installs all workspace packages

# 2. Install Playwright browsers (only needed for real scraping)
npx playwright install chromium

# 3. Start dev server
npm run dev
# → http://localhost:3000
```

### Enable real scraping

Edit `.env`:
```
USE_MOCK_ADAPTERS=false
ENABLE_SBAZAR=true
ENABLE_VINTED=true       # optional — experimental
ENABLE_FACEBOOK=false    # keep false unless you have a workaround
```

Then restart the dev server.

---

## API

### `GET /api/search`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | ✅ | Search query |
| `priceMin` | number | | Min price in CZK |
| `priceMax` | number | | Max price in CZK |
| `location` | string | | City/region filter |
| `locationRadius` | number | | Radius in km |
| `sources` | string | | Comma-separated: `bazos,sbazar,vinted,facebook` |
| `sortBy` | string | | `best_deal` \| `newest` \| `cheapest` \| `safest` |
| `debug` | boolean | | Include raw listings and score breakdowns |

**Response:**
```json
{
  "results": [...],
  "total": 12,
  "sources": [{ "source": "bazos", "success": true, "listingsFound": 8 }],
  "query": "iPhone 13",
  "executionMs": 3200,
  "debug": { ... }
}
```

---

## TODO — Hardening for Production

### Reliability
- [ ] Add Redis cache layer (`REDIS_URL`) — cache search results for 5 minutes
- [ ] Implement per-source circuit breaker (stop retrying failing sources per session)
- [ ] Playwright browser pool — avoid launching a new browser per request
- [ ] Per-source rate limit queue to avoid IP bans
- [ ] Rotating user agents and optional proxy support

### Scraper resilience
- [ ] Bazoš: test selector stability; add smoke test that fires against live site
- [ ] Sbazar: add JSON-LD schema version detection
- [ ] Vinted: add random mouse movement + scroll to reduce bot detection
- [ ] Facebook: integrate Apify / ScraperAPI or implement session-cookie-based auth

### Scoring improvements
- [ ] Replace token-overlap relevance with sentence-transformer embeddings (e.g. via Ollama locally or OpenAI API)
- [ ] Train price model on historical data per category
- [ ] Add geographic distance scoring when coordinates available

### Data quality
- [ ] Persist listings in PostgreSQL for historical price tracking
- [ ] Add description fetching (one detail-page request per listing)
- [ ] Normalise seller names for cross-source dedup

### Infrastructure
- [ ] Add error tracking (Sentry)
- [ ] Add structured logging aggregation (Loki / Datadog)
- [ ] Add Playwright test suite for each adapter
- [ ] Add Playwright smoke tests as CI health checks

### UX
- [ ] Infinite scroll / "load more" beyond top 10
- [ ] Save searches / price alerts
- [ ] Image gallery on card
- [ ] Mobile share button
