# 3. Methods

## 3.1 Data Collection

### 3.1.1 Platform selection and scope

We collected data from five active secondhand listing platforms covering two Central European markets: the Czech Republic (CZ) and Germany (DE). Platforms were selected for (a) volume of major appliance listings, (b) availability of structured condition and price fields, and (c) feasibility of respectful automated collection (see ethical note below). CZ platforms comprised Bazoš.cz (general classifieds; primary, with posting date and view counts), Aukro.cz (auction-style), and Sbazar.cz (classifieds). DE platforms comprised Kleinanzeigen (formerly eBay Kleinanzeigen; primary, dominant DE general classifieds) and Shpock. Fashion and craft platforms (Vinted, Fler) were excluded as they carry negligible appliance volume.

### 3.1.2 Query matrix

Because platforms are keyword-driven, coverage was achieved through a structured query matrix: {category term} × {brand name} × {market language}, plus unbranded category queries to capture long-tail brands. Categories were washing machines, dishwashers, refrigerators/freezers, ovens/hobs, and tumble dryers. Category terms were specified in Czech (pračka, myčka nádobí, lednice/lednička, trouba/sporák, sušička) and German (Waschmaschine, Geschirrspüler, Kühlschrank, Backofen/Herd, Wäschetrockner). Brand queries covered 25 brands prominent in the CZ/DE market: Miele, Bosch, Siemens, AEG, Electrolux, Whirlpool, Beko, LG, Samsung, Gorenje, Candy, Indesit, Zanussi, Hoover, Bauknecht, Privileg, Haier, Hisense, Sharp, Liebherr, Mora, Philco, and others.

Three harvest runs were pooled. Wave 1 (23 June 2026) and wave 2 (2 July 2026) each ran the full 264-query matrix, yielding 8,831 and 8,817 raw listings respectively after platform-level de-duplication by stable listing identifier (`{platform}:{listingId}`); 4,005 listings (45% of wave 2) appeared in both waves, i.e., were still listed nine days later. A third, Czech-only run (2 July) followed the repair of the Sbazar source adapter (whose feed endpoints had changed) and added 6,359 CZ listings, 3,813 of them from Sbazar. Pooling all runs and de-duplicating yields the analysis snapshot of 17,483 unique listings. Each run's window was kept short to minimise within-window cohort drift; the multi-wave design increases coverage of the market's flow without changing the cross-sectional identification, and subsequent waves are automated at monthly cadence (§3.6).

### 3.1.3 Ethical and legal considerations

Data collection used publicly accessible listing pages with no authentication bypass. Request pacing respected each platform's `robots.txt` and applied a minimum inter-request delay of 1,500 ms. Listings contain seller names and approximate locations; these fields were hashed at ingestion and excluded from all released artefacts. All results are reported at the brand × category aggregate level. No raw listing data is shared, and all analysis files are constructed without personally identifiable information. The data collection was conducted for non-commercial academic research.

---

## 3.2 Enrichment Pipeline

The raw harvest was passed through a deterministic enrichment pipeline that derived four variables for each listing: brand, age band, functional status, and EUR price. The pipeline is available in the replication archive.

### 3.2.1 Relevance filtering

A listing was retained if its title or description contained at least one of the category keywords in the appropriate language, and its asking price lay within plausible bounds (CZ: 200–120,000 CZK; DE: 10–5,000 EUR). Listings priced outside these bounds were treated as data entry errors or commercial bulk lots and discarded. Of 17,483 pooled raw listings, 11,369 (65.0%) passed the relevance filter.

### 3.2.2 Brand identification

Brands were identified by longest-match pattern search applied first to the listing title, then to the description. Patterns used word-boundary–style lookaheads (`(?<![a-z0-9])brand(?![a-z0-9])`) rather than `\b` anchors, which do not correctly handle the non-ASCII brand names present in CZ listings. Patterns were sorted by descending length to prevent partial matches (e.g., "Electrolux" before "LG"). A total of 25 canonical brands were mapped. Brand-parser performance was evaluated on a stratified held-out sample of 400 listings (see §3.5); precision = 0.979, recall = 0.982, F1 = 0.980.

### 3.2.3 Age triangulation

Manufacture year is not reported on any platform. We triangulated three independent signals:

**(a) Stated age or purchase year.** Regex extraction of age expressions in CZ ("stáří X let", "koupeno YYYY") and DE ("X Jahre alt", "Baujahr YYYY", "gekauft YYYY") from title and description. Reported ages of 1–40 years were retained.

**(b) Energy-label regime.** Under the EU energy-labelling framework (Regulation (EU) 2017/1369) the mandatory label scale was rescaled on 1 March 2021 for washing machines and washer-dryers (Commission Delegated Regulation (EU) 2019/2014), dishwashers (2019/2017), and refrigerating appliances (2019/2016), eliminating the former A+++ / A++ classes. A listing citing "A+++" or "A++" is therefore definitively pre-March 2021. The pattern `/\bA\s*\+{2,3}(?=[^+]|$)/` was applied to extract this signal; the lookahead (not `\b`) is necessary because `+` is not a word character in POSIX regex and a trailing `\b` would never fire. This signal is applicable only to the three rescaled categories and not to ovens or dryers.

**(c) Derived age band.** Listings were classified `old` if the energy-label signal fired (pre-2021) or stated age exceeded 5 years; `recent` if stated age was ≤5 years. All other listings were left unclassified. Overall age-band coverage was 10.6% of all listings and 13.3% of relevant brand-identified listings.

### 3.2.4 Functional status

Each listing was assigned one of four functional-status classes: *working*, *degraded*, *broken/for-parts*, or *unknown*. Classification used keyword pattern matching on the listing title and description in both languages:

- **Broken**: German — *defekt, kaputt, Bastler, Ersatzteile, Schlachtteile, reparaturbedürftig*; Czech — *na díly, nefunkční, poškozený*.
- **Working**: German — *einwandfrei, voll funktionsfähig, funktioniert einwandfrei/gut/perfekt, läuft einwandfrei, technisch einwandfrei*; Czech — *funkční, bezvadný, plně funkční*.
- **Degraded**: German — *Gebrauchsspuren, Kratzer, optische Mängel, normaler Gebrauch, kosmetische Mängel*; Czech — *normální opotřebení, stopy používání*.

Listings whose title or description contained neither class were assigned *unknown*. Condition-classifier performance on the held-out sample was: working F1 = 0.935 (P = 0.967, R = 0.906), broken F1 = 0.769 (P = 1.000, R = 0.625), degraded F1 = 0.800 (P = 0.667, R = 1.000). The broken-class recall of 0.625 implies that roughly a third of broken listings were assigned *unknown* (broken-class precision remains 1.000 — the classifier never mislabels a working machine as broken). Because this attenuation does not vary systematically across brands, it compresses S1 toward 1.0 uniformly and preserves cross-brand rank ordering; we report this as a conservative bias.

### 3.2.5 Price harmonisation

Czech prices (CZK) were converted to EUR at a fixed reference rate of 25.0 CZK/EUR, consistent with the ECB reference rate during the harvest window. Polish prices were not applicable to this study. All prices are nominal EUR.

---

## 3.3 Brand Durability Proxy

The Brand Durability Proxy (BDP) combines three complementary signals, two of which are within-brand ratios that self-normalise for brand market share.

### 3.3.1 S1 — Functional-survival ratio

For each brand *b*, S1 is defined as:

$$S_1(b) = \frac{N_{\text{working}}(b)}{N_{\text{working}}(b) + N_{\text{broken}}(b)}$$

where *N*_working and *N*_broken count listings assigned *working* and *broken* status respectively; *degraded* and *unknown* listings are excluded. A brand whose products fail early will accumulate broken listings at a relatively higher rate than working listings, depressing S1. Because the numerator and denominator are both drawn from the same brand's listing pool, S1 is invariant to market share: a brand with twice as many units sold but the same failure rate will show the same S1. We impose a minimum of 10 status-classified listings per brand (N_working + N_broken ≥ 10) to stabilise the ratio.

### 3.3.2 S2 — Residual-value retention

**Intuition.** A rational buyer of a used appliance is buying its *remaining* service life. If two machines are the same age, in the same condition, and of the same capacity, but the market persistently pays more for one brand than the other, the price gap reveals the market's expectation of how much longer that brand will run — its expected residual life. This is the logic by which the used-car literature reads reliability out of depreciation curves (Peterson & Schneider, 2014): more reliable makes depreciate more slowly. S2 ports that logic to appliances.

**Estimation.** The revealed premium is isolated with a hedonic price regression (Rosen, 1974): the price of a heterogeneous good is decomposed into implicit prices of its attributes, and whatever premium remains attached to the brand *name* — after age, condition, capacity, category, and market are held constant — is the brand fixed effect:

$$\log(\text{price}_{i}) = \alpha + \sum_b \beta_b D_{bi} + \gamma_1 \mathbf{1}[\text{old}]_i + \gamma_2 \mathbf{1}[\text{working}]_i + \gamma_3 \mathbf{1}[\text{DE}]_i + \delta \cdot \text{cap}_i + \varepsilon_i$$

where *D_bi* indicates brand *b* (Bosch as baseline, so every β̂ is read as "premium relative to a same-aged, same-condition Bosch"), `old` is the age-band dummy, `working` the functional-status dummy, `DE` a market dummy, and `cap` the capacity in kg standardised within the estimation sample (zero for categories where capacity is not parseable — dishwashers, refrigerators, ovens). The model is estimated by OLS with a ridge-stabilised inverse (10⁻⁸·I) purely as a numerical safeguard against the near-collinear columns that the capacity zeros create; the regularisation is orders of magnitude below the data scale and does not affect coefficients at reported precision. S2(b) = β̂_b from the pooled five-category model (n = 9,059; R² = 0.075).

**Worked reading.** In the pooled estimates, β̂ = −0.56 for Indesit and +0.57 for Hisense: at equal observables, the market pays exp(−0.56) ≈ 0.57× the Bosch price for an Indesit and exp(+0.57) ≈ 1.76× for a Hisense. Because the log specification makes premiums multiplicative, S2 is invariant to the overall price level of a category or market.

**What S2 is and is not.** Low R² is expected and unproblematic: asking prices in classifieds are noisy, and the model's purpose is not price prediction but the *conditional brand means*, which are estimated from hundreds of observations per brand. More important is what the fixed effect conflates: expected residual life, brand reputation (equity), and unobserved tier composition (a brand listing mostly its premium line will show a higher β̂). §4.4 uses the external test data to decompose this: the significant S2 × dTest correlation shows a genuine quality component; the Hisense outlier shows the equity residual.

### 3.3.3 S3 — Survival-tail share

**Intuition.** Durability has a simple observable implication: durable machines are still around — and still tradeable — many years after purchase. If we could observe every appliance's age, the right-hand tail of a brand's age distribution in the resale market would directly measure longevity. We cannot observe age for most listings, but the March 2021 energy-label discontinuity (§3.2.3) splits the age-banded subset cleanly into *old* (pre-2021 regime, i.e. ≥5 years at harvest, or stated age > 5 years) and *recent*. S3 is the old share of that split:

$$S_3(b) = \frac{N_{\text{old}}(b)}{N_{\text{old}}(b) + N_{\text{recent}}(b)}$$

A brand whose units survive long enough to be resold at age 5+ accumulates mass in the old band; a brand whose units die young cannot — its old cohort has already exited to waste. A minimum of 5 age-banded listings per brand is required.

**What confounds S3 — stated precisely.** Because S3 is a within-brand share, a brand's overall market size cancels: selling 10× more units scales both N_old and N_recent. What does *not* cancel is a *change* in the brand's sales over time. A brand in commercial decline (many units sold pre-2021, few since) shows a high S3 that reflects its sales trajectory, not durability; a fast-growing entrant shows a low S3 for the same reason. Both patterns are visible in our data — Indesit and Whirlpool (declining budget badges) at S3 = 94–95%, Hisense and Haier (growing entrants) at 38–65% — and both directions of the bias are *against* the durable-brand interpretation for exactly the brands where S3 is extreme. This is why S3 enters only the equally-weighted composite, is never reported as a stand-alone durability estimate, and is validated externally (§4.4): its significant correlation with Warentest quality (ρ = +0.70) shows the durability component dominates the sales-trend component across the brand panel, but individual extreme values should be read with the trajectory caveat in mind.

### 3.3.4 BDP composite

The composite combines the two signals whose expected values are free of the sales-trend confound, z-scored cross-brand and summed with equal weights:

$$\text{BDP}(b) = z(S_1) + z(S_2)$$

S3 is deliberately **excluded from the composite** and used as a corroborating, externally-validated signal only. The reason follows directly from §3.3.3: S3's extreme values are partly generated by brand sales trajectories (declining brands accumulate old-stock shares; growing entrants cannot), and including it in the composite would reward decline and punish growth in exactly the brands where S3 is most extreme. A three-signal variant z(S1)+z(S2)+z(S3) is reported as a robustness check (§4.8); the divergence between the two variants is concentrated in, and explained by, the trend-confounded brands.

### 3.3.5 The denominator problem: why market share does not drive the BDP

A brand that sells ten times more appliances will, mechanically, have roughly ten times more secondhand listings. Any measure built from *counts* of listings would therefore confuse commercial success with durability. The used-vehicle survival literature solves this with registration data: vehicle survival rates are computed as old vehicles still registered divided by that cohort's original new sales (Greenspan & Cohen, 1999; Hamilton & Macauley, 1999). Equivalent appliance sales data exist (GfK/NIQ retail panels) but are commercially confidential, so the registration-normalisation route is closed.

The BDP's answer is architectural rather than data-driven: **no BDP signal uses cross-brand listing counts.** S1 is a within-brand ratio of working to broken listings — doubling a brand's sales doubles both. S2 is a regression coefficient — conditional mean prices are invariant to how many observations estimate them (more listings only tighten the standard error). S3 is a within-brand ratio of old to recent listings — invariant to market-size *level*, though not to sales *trends*, as §3.3.3 details. Market share affects only the *precision* of each brand's signals (small brands have wider implicit confidence bands and may fail the minimum-n thresholds), never their *expected value*.

This design claim is empirically checkable, and we check it two ways (§4.8): internally, against each brand's log listing volume, and externally, against independent installed-base shares — brand ownership shares for German washing machines from a large consumer survey (Statista Consumer Insights, September 2025, n = 8,165) and brand sales shares for the Czech washing-machine market (Statista Market Insights, 2022). No correlation is significant in either test — brands with ten times the installed base do not systematically score better or worse on any BDP component, which is what the self-normalising construction predicts.

The external shares also expose why count-based normalisation — dividing a brand's listing count by its market share, the direct analogue of vehicle-survival rates — is *not* identified with keyword-harvested data: platform search returns a bounded number of pages per query, so large brands' listing counts are truncated at the harvest cap (observed: per-brand DE washing-machine counts compressed into a narrow 94–161 band despite installed bases ranging from 1% to 16%). Within-brand ratios are immune to this censoring as well; count-based survival rates require exhaustive category crawls, which we leave to future work.

---

## 3.4 Statistical Methods

### 3.4.1 Rank correlation

Cross-brand rank correlations are computed using Spearman's ρ. Bootstrap 95% confidence intervals are percentile-based with 5,000 resamples (seed = 42) of the paired brand observations. We report both ρ and the CI to convey statistical uncertainty explicitly, given the small number of brands typically in common between datasets (n = 9–17).

### 3.4.2 Hedonic OLS

Standard errors are computed from the sandwich estimator under homoscedastic assumptions. We do not apply heteroscedasticity-robust SEs because our primary use of the model is for the brand fixed effects, which are estimated on a large cross-section; robustness to heteroscedasticity would not change interpretation of the main findings.

### 3.4.3 Age-band control

For the hedonic model, the `old`-band coefficient captures both the mechanical depreciation from age and the survivor-selection premium (older units that survived are positively selected for quality). A positive coefficient on `old` — observed at +0.213 (p < 0.001) in the pooled model — indicates that the survivor premium outweighs the pure depreciation effect, consistent with H3 (survivor-selection dominates adverse selection in the appliance secondhand market).

---

## 3.5 Validation

### 3.5.1 Classifier validation

We drew a stratified random sample of 400 listings (stratified by source × category, seed = 42) and applied an independent gold-standard labeling pass to the raw title and description text, using a gold-standard brand dictionary (35 brands, sorted longest-first, applied with word-boundary lookaheads) and explicit condition keyword patterns for CZ and DE. This gold-standard labeler does not use any of the structured platform fields available to the enrichment pipeline, making it a conservative lower bound on parser performance. Results are reported in Table 2.

| Classifier | n | Precision | Recall | F1 |
|---|---|---|---|---|
| Brand parser | 400 | 0.979 | 0.982 | 0.980 |
| Condition: working | 74* | 0.967 | 0.906 | 0.935 |
| Condition: broken | 74* | 1.000 | 0.625 | 0.769 |
| Condition: degraded | 74* | 0.667 | 1.000 | 0.800 |
| Condition: macro avg | 88* | 0.758 | 0.693 | 0.709 |

*n_evaluable: listings where the gold-standard labeler could determine status from explicit keywords in title/description.

Common error patterns: (a) brand parser assigns the first-matching brand when a listing title names multiple BSH sub-brands (Bosch, Siemens, Constructa) as spare-parts compatibility; (b) condition parser misclassifies "Ersatzteil" (spare part) as *degraded* rather than *broken* in a minority of cases; (c) "degraded" has the weakest performance because the class occupies an ambiguous lexical space between working and broken.

### 3.5.2 External validation — Open Repair Alliance ORDS

We obtained the Open Repair Alliance Open Repair Data Standard (ORDS) dataset (download date: 2026-07, n = 49,994 records after filtering to "Large home electrical" category). The ORDS contains brand, product category, repair status (Fixed / Repairable / End of life), and product age at the time of repair-café events across primarily UK, Netherlands, Germany, and Austria. We constructed four brand-level metrics: fix rate (% Fixed), end-of-life rate (% End of life), overall repair attempt rate (% Fixed + % Repairable), and median product age at event. These were correlated with S1 and S3 using Spearman ρ with bootstrap CIs across the 13 brands common to both datasets (minimum 10 ORDS records per brand).

We report the ORDS correlations not as a validation of BDP accuracy but as a test of whether BDP and repair-café data capture the same quality dimension or orthogonal ones. The theoretical expectation (see §2) is that they do not: BDP measures *survivor selection* (units that did not fail to the point of disposal or discard), while ORDS measures *repairability* (units that did fail but were brought to repair events). A low or null correlation is therefore the theoretically predicted outcome, not a failure of the measurement.

### 3.5.3 Qualitative comparison with consumer-panel surveys

The second validation source is owner-reported reliability. Three consumer organisations run
large owner panels for household appliances in or near our study markets: Stiftung Warentest's
"Umfrage Haushaltsgeräte" (Germany, n ≈ 14,500 owners; Stiftung Warentest, 2018), dTest's
annual "Spolehlivost praček" reliability series (Czech Republic; dTest, 2022–2026), and
Consumentenbond's "Goede merken wasmachines" member survey (Netherlands, n > 30,000;
Consumentenbond, 2023). All three publish brand-level reliability or defect-frequency
rankings, but the full tables are subscriber-only. We therefore use the owner-survey evidence
in two deliberately limited ways: (i) a directional, non-inferential rank comparison on the
six brands whose ordinal ranking is stated in the freely available text of the Warentest
survey (Miele > Bosch ≈ Siemens > Privileg > Bauknecht > AEG), and (ii) qualitative facts
stated in the survey articles — notably Miele's 16–18-year mean lifespan and >90% owner
recommendation rate (Stiftung Warentest, 2018) — used to interpret discordances. Fully
inferential validation is reserved for the lab-test data of §3.5.4, where quantitative scores
are available.

**Directional comparison.** Spearman ρ between the inverted Warentest ordinal rank and S1 is
−0.086; between the inverted rank and the S1+S2 composite, +0.429 (n = 6; confidence
intervals are uninformative at this n and are omitted). The improvement from S1 alone to
S1+S2 is consistent with the price premium capturing perceived brand quality that the
functional-survival ratio alone does not.

**Two theoretically informative discordances.** *Miele* is ranked first by owners but shows
S1 = 86.7% — mid-table — in our data. The reconciliation follows from retention behaviour:
appliances kept for 16–18 years (Stiftung Warentest, 2018) generate few working resale
listings from any cohort, and Miele's high residual parts value means failed units are still
worth listing for parts, further depressing the working share. Open repair data corroborate
late rather than early failure: Miele units have the highest median repair-event age in ORDS
(15 years). *AEG* is ranked last by owners yet shows S1 = 93.3% — near the top. Here the
mechanism runs through repair economics: where repair is uneconomical relative to
replacement, broken units are discarded rather than listed (cf. Cooper, 2004; Wieser &
Tröger, 2018), so only surviving units reach the market and S1 is upward-biased. Both
discordances instantiate the selection mechanisms of §2 and support reading BDP as
*effective market durability* rather than absolute reliability (see §5.3).

### 3.5.4 Quantitative lab-test validation — Stiftung Warentest and dTest product scores

The primary inferential cross-validation uses published laboratory test results from
Stiftung Warentest (Germany) and dTest (Czech Republic) — the two consumer-testing
organisations aligned with our study markets, and the only sources of standardised,
product-level durability-relevant test scores for these categories. Stiftung Warentest's
washing-machine protocol includes a *Haltbarkeit* (endurance) sub-test that simulates
roughly ten years of operation per tested unit (Stiftung Warentest, various years); dTest
publishes an overall quality score (0–100) per tested product across all major appliance
categories (dTest, 2006–2025). Test results were collected from the two organisations' websites (test.de; dtest.cz) under
the first author's paid subscriptions, which grant full access to the published test tables
(Stiftung Warentest test.de flatrate; dTest předplatné). Collection used the authenticated
subscriber sessions together with in-house, rate-limited harvesting scripts that form part
of QualityDB, the authors' multi-market product-quality research database, whose scheduler
retrieves newly published test results from both sources at monthly cadence. In line with
the organisations' terms of use, the test content itself is not republished or
redistributed: the record-level data are flagged as hidden sources in QualityDB, are held
privately for research, and are excluded from the replication package; only brand-level
aggregate statistics (means over ≥2 tested products) derived for scientific comparison
appear in this paper, a use we consider covered by the quotation right for scientific works
(§ 51 UrhG; § 31(1)(c) of Czech Act No. 121/2000 Coll., the Copyright Act). The raw extract contained 3,307 Warentest and 9,073 dTest
product records spanning *all* product groups these organisations test, most outside our
scope (detergents, cookware, small kitchen electrics, consumables).

**Step 1 — Filtering to appliances.** Warentest records were retained if their category
matched one of the ten major-appliance categories in the study frame (washing machines,
washer-dryers, tumble dryers, dishwashers, refrigerators, fridge-freezers, freezers,
built-in ovens, freestanding and range cookers): 224 appliance products. dTest categories
are too coarse for this purpose (e.g. "Pračky a péče o prádlo" mixes washing machines with
laundry detergents), so filtering used the finer subgroup label: subgroups whose prefix
identifies an appliance test cycle (e.g. "Pračky 2018–2022", "Myčky od 2024") were
retained; consumables and accessories in the same top-level categories (detergents,
dishwasher tablets, irons, ironing boards, cooling boxes) were excluded. This yielded 896
appliance products spanning test cycles 2006–2025; 8,177 records were excluded.

**Step 2 — Brand resolution.** dTest brand strings embed article cross-references ("Beko
Podrobný článek: Test praček 2026"), stripped by pattern. A subset of Warentest records
store a model number rather than a brand name (e.g. "WGB244071", "LTR7A70260"); these were
resolved through a manufacturer model-prefix table (WGB/WGG/WUU → Bosch; LTR/LSR/WPNA →
AEG; WW → Samsung; etc.). Unresolvable tokens were dropped rather than guessed, and all
resolutions were spot-checked against the product-name field.

**Step 3 — Aggregation and correlation.** Scores were averaged per brand. Warentest grades
(German 1–6 school scale, lower = better) were sign-inverted before correlating so that
higher = better throughout; dTest scores (0–100) were used as published. Brand means require
≥2 tested products for the primary analyses; because the endurance sub-rating exists only
for washing machines (33 of the 224 Warentest appliance records) and several brands have a
single endurance-rated model, a sensitivity variant admitting single-product brands is also
reported. Spearman ρ with bootstrap 95% CIs (percentile method, 5,000 resamples, fixed
seed; §3.4.1) was computed between each BDP signal (S1, S2, S3) and each test measure
(Warentest overall, endurance, wash, handling, environmental; dTest overall). A correlation
is reported as significant when the bootstrap CI excludes zero. The full pipeline is in the
replication archive (`research/qualitydb_validation.py`).

**Ex-ante interpretation note.** S1 and lab-tested endurance are *not* predicted to correlate
strongly (hypothesis H3, §2.3). The survivor-selection mechanism implies that a lab-durable
brand whose machines are retained by primary owners until end-of-life shows a *lower* working
share in resale listings than its lab durability would suggest (the retention pattern
documented for Miele; Stiftung Warentest, 2018; Hennies & Stamminger, 2016), while adverse
selection depresses S1 for lab-fragile brands through a different channel. The endurance
comparison therefore functions as a mechanism probe; convergent validity is assessed against
the broader overall-quality scores and the owner-survey evidence of §3.5.3.

### 3.5.5 Cross-border rank consistency (RQ4)

S1 was estimated separately for CZ and DE. Spearman ρ between the two market-specific S1 rankings was computed for the 18 brands with at least 10 status-classified listings in each market. We note a structural limitation: CZ S1 sits at 100% for most brands regardless of sample size — Czech sellers rarely list appliances described as broken on any of the three Czech platforms — so the ceiling effect persists even after the Sbazar repair more than doubled Czech coverage (§4.7). Cross-border rank analysis is therefore informative primarily through DE S1 and price-based signals; a panel extension would be needed for robust CZ S1 estimates.

---

### 3.5.6 Additional validation sources — Which? (UK) and the French repairability index

Two further external datasets extend the validation beyond the two study markets. First,
Which? (UK) publishes laboratory test scores (0–100) for the same appliance categories;
1,092 appliance reviews with scores were extracted and aggregated to brand means (≥3 tested
products per brand). Second, France's *indice de réparabilité* — a mandatory,
manufacturer-declared, government-audited repairability score (0–10) published as open data
under the Licence Ouverte — covers 428 washing-machine and dishwasher models in our
extract. The Which? scores serve as a third lab-quality criterion; the French index serves
as a second, *regulatory* repairability criterion alongside ORDS, allowing hypothesis H4
(durability ⊥ repairability) to be tested against an official data source
(`research/which_fr_validation.py`).

## 3.6 Replication

All data collection, enrichment, and analysis scripts are available in the replication archive, together with cluster-bootstrap confidence intervals for every reported brand-level quantity, an inter-annotator kit for reproducing the classifier validation (Cohen's κ), and a monthly-wave automation script (`run_wave.sh`) that repeats the full harvest–enrich–analyse pipeline. The wave-3 confirmatory analysis is pre-registered (see `PREREGISTRATION_wave3.md` in the archive) with all pipeline parameters frozen. The enrichment pipeline is implemented in TypeScript (Node.js 20, tsx); all statistical analyses are implemented in Python 3.9 using NumPy and SciPy only, with no proprietary statistical packages. The raw JSONL snapshot is not released due to seller PII; the aggregate brand × category dataset (brand, category, S1, S2, S3, n) required for all reported results is released under a CC-BY 4.0 licence.

---

*[Placeholder: add harvest date, exact ORDS download URL/doi, reference exchange rate source, IRB/ethics statement if required by journal.]*
