# Methodology

## Direct answer

The correct first design is a **Czech proof-of-concept observational study**
that merges:

1. a large one-time snapshot of used-vehicle listings
2. historical registration cohorts
3. ideally current active-stock data

The paper should estimate a **durability proxy**, not a causal engineering
durability measure.

## Study design

### Core unit of analysis

Start with:

- `listing`

Then aggregate into:

- `brand × cohort year × age band`
- later, where quality allows:
- `brand × model × cohort year × age band`

### Main data blocks

#### A. Second-hand market data

Required listing fields:

- brand
- model
- year of origin or first registration
- mileage
- price
- location
- seller type
- description text
- source platform

#### B. Denominator data

Target denominator hierarchy:

1. best:
   - active stock by `brand/model/year`
2. second best:
   - historical new registrations by `brand/model/year`
3. fallback:
   - brand-level registration cohorts

### Year-of-origin extraction ladder

Use a strict confidence ladder:

1. listing field
2. VIN-based recovery, only when reliable
3. generation mapping, only in robustness checks

Main specifications should rely on high-confidence origin years.

## Main empirical signals

### 1. Survival / cohort persistence signal

Examples:

- `listings(age 15+) / original registrations(cohort)`
- or, if active stock is available:
- `active stock(age a) / original registrations(cohort)`

Interpretation:

- with original registrations only, the measure is a **secondary-market
  survival intensity proxy**
- with active stock, it becomes much closer to a true survival measure

### 2. Conditional price retention

Estimate hedonic models:

- dependent variable:
  - `log(price)`
- controls:
  - age
  - mileage
  - fuel
  - transmission
  - body type
  - seller type
  - region
  - platform fixed effects

Interpretation:

- the residual is not pure durability
- it is best understood as a **durability / reputation / expected repair-cost residual**

### 3. Defect-language signal

Use description text to flag:

- repair-needed language
- accident damage
- engine issues
- transmission issues
- rust / corrosion
- electronics issues

Positive condition language should also be captured:

- first owner
- service history
- garaged

## Identification rules

### What the paper can identify

- differential used-market survival intensity
- differential residual prices conditional on age and mileage
- differential defect-language prevalence

### What the paper cannot identify cleanly

- pure engineering durability
- causal brand effects on failure hazard
- true scrappage hazard from a single cross-section

That distinction must be explicit in the paper.

## Recommended first outcome objects

Keep the outputs separate before constructing any composite:

- `survival_signal`
- `price_retention_signal`
- `defect_signal`

Only after validating each component should you construct:

- `DPI_brand`
- `DPI_model`

## Validation requirements

- manual listing audit
- year extraction audit
- model harmonization audit
- missingness analysis by source
- robustness with/without dealer listings
- robustness by age bands
- robustness by fuel segment
