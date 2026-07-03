# Implementation Roadmap

## Direct answer

The implementation should proceed in a strict order. The scraper is not the
hard part. The hard part is building a dataset that supports a defensible
durability proxy.

## Step-by-step roadmap

### 1. Complete the v1 harvest and enrichment pipeline

Done in this repo revision:

- Czech vehicle research workspace
- query matrix
- enrichment logic
- snapshot persistence
- starter analysis exports

### 2. Validate the data before scaling it

Required manual checks:

- inspect at least 100 random listings
- verify:
  - brand extraction
  - model extraction
  - year extraction
  - mileage extraction
  - parts-vs-vehicle classification

Threshold:

- main-sample year accuracy should exceed 90%

### 3. Add a structured Czech vehicle source

This is the next major upgrade.

Reason:

- generic marketplaces are sufficient for proof-of-concept
- a paper-grade dataset needs at least one source with cleaner vehicle fields

Target fields:

- year
- mileage
- fuel
- transmission
- seller type
- body type

### 4. Lock the denominator source

Before writing the main results section, confirm:

- historical registrations by brand/model/year
- and, ideally, active stock by brand/model/year or age band

Without this, the paper can still do exploratory cross-sections, but not the
stronger normalized durability claim.

### 5. Build the first exploratory tables

Minimum outputs:

- brand counts by age band
- brand median price conditional summaries
- brand defect rates

### 6. Only then specify the econometric models

Do not freeze the regression specification before checking:

- missingness
- sample sizes
- year-confidence distribution
- dealer/private composition

## Practical go / no-go criteria

Proceed to full paper only if:

- at least one source provides stable vehicle coverage
- year extraction confidence is high
- sample sizes are large enough at the brand level
- denominator data are obtainable

If those conditions fail, the best fallback is:

- keep the paper as a methods / proof-of-concept note
- or pivot to a smaller set of high-volume brands/models
