# Vercel + Railway Deployment Guide

This is the recommended production setup for the marketplace apps in this repo:

- `Vercel` runs the web apps:
  - `apps/web-pl`
  - `apps/web-de`
  - `apps/web-at`
- `Railway` runs the shared backend infrastructure:
  - `PostgreSQL`
  - `Redis`
  - `worker-pl`
  - `worker-de`
  - `worker-at`

This split works well because Vercel is excellent for the Next.js UI, while Railway is a better fit for Redis, Postgres, and long-running scraper workers.

## Recommended rollout order

Start with Poland first:

1. Deploy `Redis` and `PostgreSQL` on Railway.
2. Deploy `worker-pl` on Railway.
3. Deploy `web-pl` on Vercel.
4. Test end to end.
5. Repeat the same pattern for `de` and `at`.

That gives you one clean market to debug before you scale to all three.

## Railway setup

Create one Railway project and add these services:

- `PostgreSQL`
- `Redis`
- `worker-pl`
- `worker-de`
- `worker-at`

### PostgreSQL

Use the Railway PostgreSQL template.

You will use:

- `DATABASE_URL` inside Railway workers
- the external/public Postgres URL for Vercel web apps

### Redis

Use the Railway Redis template.

You will use:

- `REDIS_URL` inside Railway workers
- the external/public Redis URL for Vercel web apps

## Worker services on Railway

Create one service per worker from this repo.

### `worker-pl`

- Source: this GitHub repo
- Dockerfile path: `Dockerfile.worker-pl`

### `worker-de`

- Source: this GitHub repo
- Dockerfile path: `Dockerfile.worker-de`

### `worker-at`

- Source: this GitHub repo
- Dockerfile path: `Dockerfile.worker-at`

These workers do not need a public domain.

### Worker environment variables

Set these on every worker service:

```bash
REDIS_URL=<Railway internal Redis URL>
DATABASE_URL=<Railway internal Postgres URL>
SEARCH_WORKER_ENABLED=true
WORKER_CONCURRENCY=2
WORKER_POLL_INTERVAL_MS=1000
SEARCH_JOB_TTL_MS=900000
PLAYWRIGHT_MAX_CONTEXTS=1
SOURCE_LIMIT_DEFAULT=1
SOURCE_LIMIT_VINTED=3
SOURCE_LIMIT_WILLHABEN=2
SOURCE_LIMIT_KLEINANZEIGEN=2
SOURCE_LIMIT_SHPOCK=2
SOURCE_LIMIT_OLX=2
SOURCE_LIMIT_ALLEGRO_LOKALNIE=1
SOURCE_LIMIT_SPRZEDAJEMY=2
```

Notes:

- Keep `PLAYWRIGHT_MAX_CONTEXTS=1` initially. It is safer for memory.
- `WORKER_CONCURRENCY=2` is a good first production setting.
- You can tune source limits later if a source is stable.

## Vercel setup

Create three Vercel projects from the same repo.

### `web-pl`

- Framework: Next.js
- Root directory: `apps/web-pl`

### `web-de`

- Framework: Next.js
- Root directory: `apps/web-de`

### `web-at`

- Framework: Next.js
- Root directory: `apps/web-at`

## Web app environment variables

Use the external/public Railway URLs here, because Vercel runs outside Railway's private network.

### `web-pl`

```bash
REDIS_URL=<Railway public Redis URL>
DATABASE_URL=<Railway public Postgres URL>
SEARCH_WORKER_ENABLED=true
SEARCH_RATE_LIMIT=20
SEARCH_RATE_WINDOW_MS=60000
SEARCH_STREAM_RATE_LIMIT=10
SEARCH_STREAM_RATE_WINDOW_MS=60000
SEARCH_SYNC_WAIT_MS=25000
SEARCH_STREAM_WAIT_MS=65000
```

### `web-de`

```bash
REDIS_URL=<Railway public Redis URL>
SEARCH_WORKER_ENABLED=true
SEARCH_RATE_LIMIT=20
SEARCH_RATE_WINDOW_MS=60000
SEARCH_STREAM_RATE_LIMIT=10
SEARCH_STREAM_RATE_WINDOW_MS=60000
SEARCH_SYNC_WAIT_MS=25000
SEARCH_STREAM_WAIT_MS=65000
```

### `web-at`

```bash
REDIS_URL=<Railway public Redis URL>
SEARCH_WORKER_ENABLED=true
SEARCH_RATE_LIMIT=20
SEARCH_RATE_WINDOW_MS=60000
SEARCH_STREAM_RATE_LIMIT=10
SEARCH_STREAM_RATE_WINDOW_MS=60000
SEARCH_SYNC_WAIT_MS=25000
SEARCH_STREAM_WAIT_MS=65000
```

Notes:

- `web-pl` needs `DATABASE_URL` because it persists feedback.
- `web-de` and `web-at` currently do not require Postgres for user-facing routes.
- Railway documents that external Postgres/Redis access is supported via TCP Proxy. Expect some network egress cost on the Railway side.

## Domains

Once deployed:

- add your production domains in Vercel
- keep Railway workers private
- do not expose Railway workers directly to the internet unless you explicitly add an HTTP admin endpoint later

## Smoke test checklist

### Poland

1. Open the Vercel `web-pl` URL.
2. Search for `iphone`.
3. Confirm results arrive instead of timing out.
4. Check Railway logs for `worker-pl`.

### Germany

1. Open the Vercel `web-de` URL.
2. Search for `fahrrad`.
3. Confirm `Kleinanzeigen`, `willhaben`, or `Vinted` appear in source statuses.
4. Check Railway logs for `worker-de`.

### Austria

1. Open the Vercel `web-at` URL.
2. Search for `winterjacke`.
3. Confirm `Shpock`, `willhaben`, or `Vinted` appear in source statuses.
4. Check Railway logs for `worker-at`.

## First tuning pass

Once all three are live, adjust these first:

- lower `WORKER_CONCURRENCY` if Railway memory spikes
- lower per-source limits if a marketplace starts blocking requests
- increase `SEARCH_JOB_TTL_MS` if users often repeat similar searches
- keep the web apps stateless and let Redis absorb repeated traffic

## Troubleshooting

### Searches work locally but not in production

Check:

- Vercel has `SEARCH_WORKER_ENABLED=true`
- Vercel has the public `REDIS_URL`
- Railway workers have the internal `REDIS_URL`
- workers are actually running and not crashing on startup

### Worker never picks up jobs

Check:

- all services point at the same Redis instance
- `SEARCH_WORKER_ENABLED=true`
- Railway worker logs show startup and no Redis connection failure

### Web app times out and falls back slowly

Check:

- Railway worker CPU and memory
- source throttles are not too strict
- marketplace sites are not blocking your IP

### Redis hostname problems on Railway

Railway notes that private hostnames are only valid inside the same Railway project/environment. Vercel must use the public Redis URL, not the internal private one.
