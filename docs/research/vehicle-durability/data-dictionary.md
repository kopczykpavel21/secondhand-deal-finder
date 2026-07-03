# Data Dictionary

## Direct answer

The research dataset should be built in two layers:

1. raw listing snapshot
2. derived analytical variables

This split matters because the enrichment logic will change as the paper
improves.

## Raw listing fields

### Identifiers

- `harvest_batch`
- `captured_at`
- `source`
- `source_listing_id`
- `id`
- `url`

### Listing content

- `title`
- `description`
- `price`
- `currency`
- `location`
- `posted_at`
- `image_count`
- `image_url`

### Existing seller / marketplace variables

- `seller_name`
- `seller_rating`
- `seller_review_count`
- `views`
- `likes`
- `promoted`

## Derived vehicle variables

### Normalization

- `normalized_brand`
- `normalized_model`
- `listing_kind`

`listing_kind` should separate:

- `vehicle`
- `parts`
- `unknown`

### Age / cohort variables

- `year_origin`
- `year_origin_source`
- `year_origin_confidence`
- `vehicle_age`
- `age_band`

### Mechanical / product attributes

- `mileage_km`
- `vin`
- `fuel_type`
- `transmission`
- `body_type`
- `seller_type`

### Text-based defect and quality flags

- `repair_needed`
- `accident_damaged`
- `engine_issue`
- `transmission_issue`
- `rust_issue`
- `electronics_issue`
- `service_history`
- `first_owner`
- `garaged`

## Future denominator merge fields

These are not always available in the scrape itself, but the downstream merged
dataset should eventually contain:

- `cohort_registrations`
- `active_stock`
- `registrations_source`
- `stock_source`

## Target analytical variables

- `survival_intensity_proxy`
- `older_15_plus_indicator`
- `log_price`
- `defect_indicator`
- `durability_proxy_component_survival`
- `durability_proxy_component_price`
- `durability_proxy_component_defect`

## Main principle

Never overwrite the raw information permanently.

Keep:

- raw listing fields
- enrichment output
- merged denominator data

as separate layers, so the paper can be replicated and the extraction rules can
be revised without a new scrape.
