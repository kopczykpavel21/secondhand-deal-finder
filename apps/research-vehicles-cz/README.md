# Research harvester — Czech vehicle durability proxy

This workspace implements the first paper pipeline for:

- **market:** Czech Republic
- **unit:** passenger vehicles
- **claim:** a **durability proxy**, not direct engineering durability

It is the executable counterpart to the Q1 paper plan:

- one large cross-sectional scrape
- typed extraction of `brand`, `model`, `year origin`, `mileage`
- text-based defect signals
- exploratory outputs for `brand × age band`

## Why vehicles first

Vehicles are the strongest first paper because they have:

- much cleaner **year-of-origin** information than appliances/electronics
- much more standardized **brand/model naming**
- a plausible path to a valid denominator:
  - historical registrations
  - active stock / fleet counts
- a more established literature benchmark around used-market quality and sorting

## What this v1 implementation does

- Reuses the current Czech fetch-based adapters already in the repo:
  - `TipCars`
  - `Bazos`
  - `Sbazar`
- Excludes `Aukro` from the research pipeline by default because the generic
  marketplace results are too heavily polluted by parts, memorabilia and
  accessories for the first durability paper.
- Builds a Czech brand/model query matrix for common passenger-car brands.
- Extracts and stores:
  - normalized brand
  - normalized model
  - year of origin
  - year-source confidence
  - mileage
  - VIN when present
  - fuel, transmission, body type
  - seller type
  - defect / condition language flags
- Persists everything either to:
  - Postgres table `cz_vehicle_listings_snapshot`
  - or JSONL fallback in `./data`
- Exports starter CSVs for exploratory analysis.

## Important limitation

This is a **proof-of-concept research pipeline**, not the final journal-grade
collection stack. The current repo does **not** yet include dedicated
auto-portal adapters. That means:

- v1 is good enough to test the identification strategy and enrichment logic
- v2 should add at least one structured Czech vehicle source before the final paper

## Running

```bash
# show the planned query matrix only
npm run harvest:pilot --workspace=apps/research-vehicles-cz -- --dry-run

# small pilot
npm run harvest:pilot --workspace=apps/research-vehicles-cz

# medium validation run that stops after roughly 1,000 kept vehicle listings
npm run harvest --workspace=apps/research-vehicles-cz -- --target-listings 1000 --price-min 15000

# full first-pass harvest
npm run harvest --workspace=apps/research-vehicles-cz

# export starter CSV tables from the latest JSONL file
npm run analyze --workspace=apps/research-vehicles-cz

# create a 100-row manual audit sheet for year/model validation
npm run audit-sample --workspace=apps/research-vehicles-cz

# optionally include Aukro for a robustness sample
npm run audit-sample --workspace=apps/research-vehicles-cz -- --sources tipcars,bazos,sbazar,aukro

# build the regression-ready dataset after you add denominator CSV files
npm run build-dataset --workspace=apps/research-vehicles-cz

# run the first price and defect regressions
npm run regressions --workspace=apps/research-vehicles-cz

# convert one SDA monthly XLSX workbook into the normalized registrations CSV
npm run convert-sda-registrations --workspace=apps/research-vehicles-cz -- /path/to/2026-5.monthly.CZ.xlsx --output data/denominators/cz_new_registrations.csv
```

### Useful flags

| Flag | Meaning |
|---|---|
| `--pilot` | Pilot scope: fewer brands and models |
| `--dry-run` | Print plan only, no requests |
| `--limit N` | Cap the number of queries executed |
| `--max-brands N` | Limit number of brands |
| `--max-models N` | Limit number of models per brand |
| `--price-min N` | Minimum price passed to source adapters |
| `--target-listings N` | Stop the harvester once it has kept roughly `N` unique vehicle listings |
| `--sources a,b,c` | Restrict audit or dataset build to specific sources. Default: `tipcars,bazos,sbazar` |

### Environment

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | _(unset)_ | Postgres connection. If unset, JSONL fallback is used. |
| `HARVEST_OUT_DIR` | `./data` | JSONL output directory |
| `INTER_QUERY_DELAY_MS` | `1500` | Politeness delay between query batches |
| `ENABLE_AUKRO_RESEARCH` | `false` | Include Aukro in the research harvester only when you explicitly want a noisier robustness source |

## Output files

The analysis exporter writes:

- `brand_age_counts.csv`
- `brand_price_summary.csv`
- `brand_defect_rates.csv`
- `brand_model_age_counts.csv`

These are not final econometric outputs. They are the first exploratory tables
needed before the paper specification is frozen.

The dataset builder also writes:

- `vehicle_listing_analysis_dataset.csv/json`
- `vehicle_cohort_aggregate_dataset.csv/json`
- `analysis_metadata.json`

`analysis_metadata.json` explicitly records whether the run used:

- `registrations_only`
- or `registrations_and_active_stock`

If only registrations are available, the output should be interpreted as a
**secondary-market survival intensity proxy**, not pure physical survival.

## Denominator inputs

The dataset builder expects:

- `data/denominators/cz_new_registrations.csv`
- optionally: `data/denominators/cz_active_stock.csv`

Expected columns are flexible, but should map to:

- `brand`
- `model`
- `cohort_year`
- `registrations` or `active_stock`
