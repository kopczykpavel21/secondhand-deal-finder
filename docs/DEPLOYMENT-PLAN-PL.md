# Deployment Plan for `apps/web-pl`

This document describes how to run the Polish marketplace app for many users at the same time without relying on a single Next.js process to do all scraping work inline.

It is written against the current repository structure:

```text
apps/web-pl
packages/core
packages/scoring
packages/source-adapters
packages/types
```

## Goal

Turn the current app into a production-ready system that:

- serves the UI quickly under concurrent traffic
- avoids re-running the same marketplace searches on every request
- isolates fragile scraping from the web frontend
- persists user feedback and future product features like saved searches
- can scale horizontally

## Current Bottlenecks

The current code works well for an MVP, but these pieces do not scale cleanly for real traffic:

- search runs directly inside Next route handlers in `apps/web-pl/src/app/api/search/route.ts` and `apps/web-pl/src/app/api/search/stream/route.ts`
- cache is only in-memory in `packages/core/src/search-coordinator.ts`
- feedback is only in-memory in `apps/web-pl/src/app/api/feedback/route.ts`
- Playwright sources are globally serialized by `MAX_CONTEXTS = 1` in `packages/source-adapters/src/browser-pool.ts`

That means one instance can work for demos, but multiple app instances will not share cache, and scraping load will rise too fast as traffic grows.

## Recommended Architecture

Use four layers:

1. `web-pl` frontend
2. API layer
3. worker layer
4. shared infrastructure

Suggested shape:

```text
Users
  |
  v
apps/web-pl (Next.js UI + thin API)
  |
  +--> Redis
  |      - result cache
  |      - rate limiting
  |      - short-lived search job state
  |
  +--> Postgres
  |      - feedback
  |      - saved searches
  |      - alert subscriptions
  |      - optional historical listings
  |
  +--> apps/worker-pl
         - runs marketplace adapters
         - enforces per-source throttling
         - writes results back to Redis/Postgres
```

## What Stays Where

### Keep in `apps/web-pl`

- all UI pages and components
- search form and result rendering
- source filters
- streaming or polling result consumption

The web app should become mostly stateless.

### Keep in shared packages

- `packages/types`
- `packages/scoring`
- `packages/core`
- `packages/source-adapters`

These are already reusable and should be shared between the frontend API layer and the worker.

### Add a new worker app

Create:

```text
apps/worker-pl
```

Responsibilities:

- receive a normalized search request
- run enabled Polish adapters
- score and deduplicate results
- write final results to Redis
- optionally store snapshots in Postgres

It can be a simple Node service, not another Next app.

## Request Flow

### Recommended search flow

1. User submits search in `apps/web-pl`.
2. API normalizes the request into a deterministic cache key.
3. API checks Redis for a completed result.
4. If cached, return immediately.
5. If not cached:
   - create a job ID
   - write job status to Redis
   - enqueue work for `apps/worker-pl`
6. Worker runs the source adapters.
7. Worker writes:
   - per-source progress
   - partial status
   - final result payload
8. Frontend either:
   - polls for job status, or
   - receives SSE from an API route that reads job progress from Redis

This avoids tying one open browser tab to one full scraping session inside the web server.

## Redis Design

Use Redis for three things.

### 1. Result cache

Key:

```text
search:result:{hash}
```

TTL:

- 2 to 10 minutes for live marketplace results

Stored value:

- query
- filters
- ranked results
- source statuses
- execution time
- timestamp

### 2. Job progress

Keys:

```text
search:job:{jobId}:status
search:job:{jobId}:events
search:job:{jobId}:result
```

TTL:

- 10 to 30 minutes

This powers progress UI without keeping everything in web memory.

### 3. Rate limiting

Keys:

```text
ratelimit:ip:{ip}
ratelimit:user:{userId}
ratelimit:source:{source}
```

Use this for:

- frontend abuse protection
- per-source request throttling

## Postgres Design

Persist the things that should survive restarts.

### Start with these tables

#### `feedback_entries`

- `id`
- `submitted_at`
- `rating`
- `improvements`
- `comment`
- `email`

#### `saved_searches`

- `id`
- `user_id` or `anonymous_token`
- `query`
- `filters_json`
- `created_at`

#### `alert_subscriptions`

- `id`
- `saved_search_id`
- `channel`
- `target`
- `created_at`
- `enabled`

### Optional later

#### `listing_snapshots`

Useful for:

- price history
- alerting on new results
- tracking recurring sellers

Fields:

- `source`
- `source_listing_id`
- `query_hash`
- `title`
- `price`
- `currency`
- `location`
- `captured_at`
- `raw_metadata_json`

## Worker Design

Create `apps/worker-pl` with:

- a queue consumer
- access to the same shared packages
- Redis connection
- Postgres connection

Recommended worker responsibilities:

- fetch live source data
- run `SearchCoordinator`
- write progress per source
- cache final result
- record error metrics

### Important source policy

Do not let every incoming user request hit every marketplace directly.

Instead:

- collapse identical searches into the same cache key
- cap source concurrency
- add retries only where they help
- disable unstable sources temporarily when error rate spikes

## Per-Source Concurrency

Use explicit per-source caps.

Suggested starting point:

- `vinted`: 3 concurrent jobs
- `olx`: 2 concurrent jobs
- `sprzedajemy`: 2 concurrent jobs
- `allegro_lokalnie`: 1 concurrent job
- Playwright-based sources: 1 or 2 total browser contexts per worker

These are intentionally conservative.

The right way to scale is:

- more cache hits
- more worker replicas
- not unlimited parallel scraping

## Web/API Changes to Make

### Search routes

Current:

- `apps/web-pl/src/app/api/search/route.ts`
- `apps/web-pl/src/app/api/search/stream/route.ts`

Change them so they:

- validate input
- normalize a cache key
- check Redis first
- enqueue a worker job if missing
- return cached result or job progress

### Feedback route

Current:

- `apps/web-pl/src/app/api/feedback/route.ts`

Change it to:

- write to Postgres
- paginate admin feedback reads
- remove in-memory storage

## Deployment Topology

### Good MVP production setup

- `1-2` web instances
- `1` worker instance
- managed Redis
- managed Postgres

### Safer growth setup

- `2-3` web instances
- `2+` worker instances
- managed Redis with persistence
- managed Postgres
- monitoring and alerting

## Hosting Recommendation

### Option A: Railway

Good if you want the simplest path.

Services:

- `web-pl`
- `worker-pl`
- `redis`
- `postgres`

Pros:

- easy internal networking
- simple environment variable setup
- easy logs

Cons:

- less flexible at larger scale

### Option B: Vercel + Railway/Render/Fly

Use:

- Vercel for `apps/web-pl`
- Railway/Render/Fly for worker
- managed Redis/Postgres

Pros:

- great frontend hosting
- clean separation between UI and scraping backend

Cons:

- slightly more moving parts

## Environment Variables

### Web app

Suggested:

```text
REDIS_URL=
DATABASE_URL=
SEARCH_RESULTS_TTL_SECONDS=300
ENABLE_VINTED=true
ENABLE_OLX=true
ENABLE_ALLEGRO_LOKALNIE=true
ENABLE_SPRZEDAJEMY=true
PUBLIC_APP_URL=
```

### Worker

Suggested:

```text
REDIS_URL=
DATABASE_URL=
WORKER_CONCURRENCY=4
ENABLE_VINTED=true
ENABLE_OLX=true
ENABLE_ALLEGRO_LOKALNIE=true
ENABLE_SPRZEDAJEMY=true
PLAYWRIGHT_HEADLESS=true
```

## Monitoring

Add these before opening to many users:

- request count
- cache hit rate
- per-source success rate
- per-source latency
- worker queue depth
- worker error count
- search timeout count

At minimum, track:

- `search_total`
- `search_cache_hit`
- `search_cache_miss`
- `source_success_total`
- `source_failure_total`
- `source_duration_ms`

## Security and Abuse Protection

Add:

- IP-based rate limiting on search endpoints
- basic bot throttling
- request size limits
- query length caps
- per-user cooldown for repeated identical misses

Do not expose open scraping capacity to the public internet with no rate control.

## Rollout Plan

### Phase 1

- keep `apps/web-pl`
- add Redis
- move result cache out of memory
- move feedback to Postgres

### Phase 2

- add `apps/worker-pl`
- move live adapter execution to worker
- turn API routes into queue/cache orchestration

### Phase 3

- add per-source concurrency limits
- add metrics and alerts
- add saved searches and email alerts

### Phase 4

- optional listing snapshot history
- optional category-specific ranking
- optional multi-region deployment

## Concrete Next Step

If implementing incrementally, do this first:

1. create `apps/worker-pl`
2. add Redis cache wrapper package or module
3. change `apps/web-pl/src/app/api/search/route.ts` to use Redis before live search
4. change `apps/web-pl/src/app/api/feedback/route.ts` to Postgres

That sequence gives the biggest production gain with the smallest architecture jump.
