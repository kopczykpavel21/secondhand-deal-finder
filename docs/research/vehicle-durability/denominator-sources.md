# Denominator Sources

## Direct answer

The denominator source is now locked as follows:

### Primary cohort-size denominator

- **SDA/CIA public monthly XLSX files**
- Use these for:
  - new passenger-car registrations
  - brand-level and, where available in the workbook, model-level cohort counts

### Preferred stock / survival denominator

- **SDA/CIA `CFC-Fleet` fleet snapshots**
- Use these when the published fleet tables expose enough disaggregation for:
  - brand
  - age band
  - or model/year

If the fleet files are too aggregated, keep them as an **external validation
source** and use registrations as the main denominator.

## Source evidence

The public SDA/CIA portal is live here:

- [SDA portal](https://portal.sda-cia.cz/)

The public download repository lists:

- monthly registration files in `XLSX`
- fleet snapshots labelled `CFC-Fleet`

Repository page:

- [SDA public repository](https://www.sda-cia.cz/repository-volnedostupna?lang=CZ)

Observed on the public repository page:

- entries such as `2026-5.monthly.CZ.xlsx`
- entries such as `2026-3.CFC-Fleet.CZ.pdf`
- year coverage visible back to at least 2005 in the public archive

## Step-by-step reasoning

### 1. Why SDA/CIA monthly files are the right primary denominator

They are the strongest immediately usable public source because they are:

- Czech-market specific
- regularly updated
- downloadable in spreadsheet format
- explicitly about registrations

That makes them suitable for:

- cohort construction by year
- brand-level normalization
- potential model-level normalization after workbook inspection

### 2. Why fleet stock is secondary for now

The fleet snapshots are promising, but they may not expose all dimensions needed
for a model-level stock denominator.

So the correct rule is:

- use fleet stock if disaggregation is sufficient
- otherwise use it for validation, not as the primary regression denominator

### 3. What this means for the paper claim

If the final denominator is:

- `registrations only`

then the paper estimates:

- **secondary-market survival intensity**

If the final denominator includes:

- `active stock`

then the survival interpretation becomes materially stronger.

## Operational rule for the repo

The data pipeline should expect these two local inputs:

- `data/denominators/cz_new_registrations.csv`
- `data/denominators/cz_active_stock.csv`

The first one is **required** for the main dataset builder.
The second one is **optional** but preferred.
