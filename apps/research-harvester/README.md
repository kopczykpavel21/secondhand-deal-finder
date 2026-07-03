# Research harvester — appliance durability proxy

One-time, cross-sectional scrape of the **Czech + German** secondhand market for
**major household appliances** (washing machines, dishwashers, fridges, ovens,
dryers), feeding the brand-durability-proxy study.

Full research design: `~/.claude/plans/pure-rolling-sedgewick.md`.

## What it does

- Reuses the production **fetch-based** source adapters — `Bazoš`, `Sbazar`,
  `Aukro` (CZ) and `Kleinanzeigen`, `Shpock` (DE). No Playwright/browser is
  launched (only the module is loaded), so no `playwright install` is needed.
- Iterates a **brand × category × market** query matrix (`src/query-matrix.ts`):
  bare-category queries catch the long tail; `brand + category` combos deepen
  coverage for the ~25 scored brands.
- De-duplicates by stable listing id (`source:sourceListingId`) across the whole
  run and persists the full `NormalizedListing` + raw adapter metadata so all
  downstream variables (brand, age, functional status, specs) can be re-derived
  in enrichment **without re-scraping**.

## Running

```bash
# tiny smoke test (1 brand, capped queries) — safe, few requests
npx tsx apps/research-harvester/src/index.ts --pilot --max-brands 1 --limit 4

# print the plan only, no requests
npm run harvest:pilot --workspace=apps/research-harvester -- --dry-run

# pilot harvest (washing machines × top-10 brands × CZ+DE) — the go/no-go gate
npm run harvest:pilot --workspace=apps/research-harvester

# full harvest (all 5 categories × full brand matrix × CZ+DE)
npm run harvest --workspace=apps/research-harvester
```

### Flags

| Flag | Meaning |
|---|---|
| `--pilot` | Pilot scope: washing machines × top-10 brands × CZ+DE |
| `--dry-run` | Build the matrix and print the plan; make no requests |
| `--limit N` | Cap the number of queries executed |
| `--max-brands N` | Cap brands per category |
| `--price-min N` | Pass a minimum price filter to adapters (default: none) |

> Keep `--price-min` low or unset: cheap **broken / for-parts** listings are
> signal (the functional-status durability proxy), not noise.

### Environment

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | _(unset)_ | Postgres connection. **If unset, output falls back to JSONL.** |
| `HARVEST_OUT_DIR` | `./data` | JSONL output directory |
| `INTER_QUERY_DELAY_MS` | `1500` | Politeness delay between queries |

## Output

- **Postgres:** table `appliance_listings_snapshot` (created automatically),
  keyed by `(harvest_batch, id)`, one row per unique listing with its
  discovering query context + `raw_metadata` JSONB.
- **JSONL fallback:** `./data/<batch>.jsonl`, one JSON object per listing.

## Ethics / ToS / GDPR

- Adapters rate-limit internally; an additional `INTER_QUERY_DELAY_MS` spaces
  queries. Be polite; respect each site's robots.txt and Terms.
- Listings contain seller names/locations. `seller_name` is kept in the
  **working** snapshot only. Any **released** dataset must aggregate to
  brand×category and drop/hash seller identifiers.
