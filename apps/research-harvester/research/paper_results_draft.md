# §4  Results

## 4.1  Descriptive statistics and data accounting

Three pooled harvest runs yielded **17,483 unique listings** across five categories (washing
machines, dishwashers, refrigerators/freezers, ovens, dryers) and two markets (CZ, DE):
wave 1 (23 June 2026, full query matrix), wave 2 (2 July, full matrix), and a same-day
CZ-only extension run after the repair of the Sbazar source adapter, which alone contributed
3,813 Czech listings. Because each BDP signal requires a different variable to be parseable
from the listing text, each is computed on a different subset of the data. Table 0 makes
this accounting explicit; every *n* reported later in the paper traces back to one of these
pools.

**Table 0. Data accounting: from raw harvest to analysis pools.**

| Stage | n | % of harvest | Used for |
|-------|---|--------------|----------|
| Harvested, de-duplicated across all runs | 17,483 | 100% | — |
| Relevant appliance listing (parts/accessories/services dropped) | 11,369 | 65.0% | — |
| … and brand identified | 10,121 | 57.9% | Table 1 column *n* |
| … and price parsed | 9,412 | 53.8% | S2 hedonic pool (9,059 in estimation) |
| … and functional status stated (working/degraded/broken) | 4,622 | 26.4% | — |
| … of which explicitly working or broken | 4,326 | 24.7% | S1 pool (*S1_n*) |
| … and vintage band identified (old/recent) | 1,223 | 7.0% | S3 pool (*S3_n*) |

![**Figure 1.** Data accounting: attrition from raw harvest to the analysis pools. Each BDP signal is computed on the largest pool where its input variable is parseable.](figures/fig4_data_funnel.png)

Three attrition steps deserve comment. First, a third of harvested listings are not
analysable appliances — spare parts, accessories, and service ads that keyword search
inevitably returns; dropping them is deliberate filtering, not data loss. Second, 54% of the
brand-identified listings do not state functional status in their text (the share rose with
the Sbazar addition, whose listings are typically short); the condition classifier
deliberately assigns *unknown* rather than guessing, so S1 is computed only on the 4,326
listings with an explicit working/broken statement (per-brand counts are reported as *S1_n*
in Table 1). Third, the vintage band requires either a stated age or an energy-label class,
which only 12.1% of brand-identified listings provide; S3 is therefore the thinnest signal
and is used only as a corroborating signal, never in the composite (§3.3.4). The market
split of the analysis set is DE 7,260 / CZ 2,861 — the Sbazar repair more than doubled the
Czech share relative to the two-wave pool (from 14% to 28% of the analysis set).

Of the 4,622 status-classified listings, 80.5% were working, 6.4% degraded, and 13.1%
broken/for-parts. Category composition of the analysis set: washing machines (3,687 /
36.4%), refrigerators/freezers (2,373 / 23.4%), ovens (1,919 / 19.0%), dishwashers (1,904
/ 18.8%), dryers (238 / 2.4%). Median listing price ranged from €100 (Whirlpool, Indesit,
Privileg) to €349 (Hisense), with Miele at €220 — counter-intuitively unremarkable given
its premium retail price, explained below.

The nine-day interval between the two full waves provides a first glimpse of market flow:
45% of wave-2 listings were already present in wave 1, implying that roughly half of the
appliance stock turns over (sells or is withdrawn) within nine days. This flow statistic is
not used in the BDP itself but demonstrates the feasibility of the panel extension of §5.7,
which is now automated (monthly waves; §3.6).

---

## 4.2  BDP signals and composite score

**Table 1. Brand Durability Proxy — pooled results (20 brands with n ≥ 100 and S1
coverage, ordered by BDP_z).**

| Rank | Brand | n | S1 (S1_n) | S2_FE | S3 (S3_n) | Med€ | BDP_z |
|------|-------|---|-----------|--------|-----------|-------|-------|
| 1 | Hisense | 208 | 89.3% (104) | +0.566*** | 65.0% (20) | 349 | +2.50 |
| 2 | Haier | 324 | 88.8% (166) | +0.278*** | 39.0% (41) | 250 | +1.56 |
| 3 | Liebherr | 184 | 90.3% (77) | +0.048 | 68.2% (22) | 190 | +1.13 |
| 4 | AEG | 769 | 90.9% (332) | −0.060 | 67.9% (78) | 170 | +0.91 |
| 5 | Bosch | 832 | 89.7% (361) | 0.000 (ref) | 72.2% (115) | 196 | +0.89 |
| 6 | Beko | 859 | 89.9% (380) | −0.059 | 72.6% (135) | 165 | +0.76 |
| 7 | Siemens | 780 | 90.8% (370) | −0.127* | 75.7% (107) | 180 | +0.69 |
| 8 | Samsung | 700 | 81.9% (361) | +0.321*** | 60.0% (85) | 250 | +0.58 |
| 9 | Miele | 688 | 85.3% (313) | +0.073 | 85.7% (63) | 220 | +0.40 |
| 10 | LG | 429 | 81.2% (190) | +0.181** | 68.9% (90) | 216 | +0.05 |
| 11 | Gorenje | 760 | 84.9% (342) | −0.038 | 48.3% (87) | 180 | +0.00 |
| 12 | Hoover | 220 | 83.5% (112) | −0.008 | 75.0% (40) | 180 | −0.14 |
| 13 | Bauknecht | 594 | 84.7% (321) | −0.112* | 57.0% (100) | 160 | −0.25 |
| 14 | Sharp | 248 | 81.4% (150) | +0.023 | 32.4% (34) | 180 | −0.39 |
| 15 | Candy | 296 | 84.4% (143) | −0.336*** | 82.8% (29) | 128 | −0.95 |
| 16 | Privileg | 476 | 85.3% (256) | −0.416*** | 58.0% (50) | 100 | −1.05 |
| 17 | Zanussi | 280 | 81.0% (139) | −0.185** | 71.4% (14) | 125 | −1.07 |
| 18 | Electrolux | 501 | 81.6% (170) | −0.297*** | 82.8% (29) | 136 | −1.29 |
| 19 | Whirlpool | 434 | 78.9% (163) | −0.424*** | 94.2% (52) | 100 | −2.10 |
| 20 | Indesit | 228 | 79.8% (112) | −0.563*** | 95.2% (21) | 100 | −2.37 |

*Notes.* Column *n* is all relevant, brand-identified listings for the brand. *S1_n* (in
parentheses) is the subset of *n* whose text explicitly states working or broken status —
the denominator of S1; the classifier never guesses status, so listings without a status
statement are excluded rather than imputed (§3.2.4). *S3_n* is the (small) subset with a
parseable vintage band. S2_FE = pooled hedonic brand fixed effect (Bosch = reference),
estimated on the priced pool; *p<.05, **p<.01, ***p<.001. BDP_z = z(S1) + z(S2); S3 is
shown for corroboration and is excluded from the composite (§3.3.4). Small-n or
low-coverage brands (Philco, Mora, Romo, Concept, ETA) enter the composite where signals
permit but are omitted from the table. Bootstrap 95% CIs for every cell are in the
replication package (`bootstrap_cis.csv`); the headline intervals appear in §4.8.

![**Figure 2.** BDP composite ranking, pooled data, brands with n ≥ 100 listings. BDP_z = z(S1) + z(S2); green = above cross-brand mean, red = below.](figures/fig1_bdp_ranking.png)

**S1 (functional-survival ratio)** ranged from 78.9% (Whirlpool) to 90.9% (AEG). The BSH
group (Bosch 89.7%, Siemens 90.8%) and AEG occupy the top, while the Whirlpool-group budget
badges (Whirlpool 78.9%, Indesit 79.8%) anchor the bottom — an 11-point gap in the share of
listings still working. Miele's S1 (85.3%) again sits mid-table, the anomaly addressed in
§4.5.

**S2 (residual-value premium)** ranged from −0.563 log-points (Indesit) to +0.566
(Hisense) — at equal age, condition, and specification, an Indesit fetches about 43% less
and a Hisense about 76% more than the Bosch baseline. Asian-headquartered brands (Hisense,
Samsung, Haier, LG) command the four largest significant premiums; the Whirlpool-group and
Electrolux-group budget badges (Indesit, Whirlpool, Privileg, Candy, Electrolux) carry the
five largest significant discounts.

**S3 (old-vintage share)** ranged from 32.4% (Sharp) to 95.2% (Indesit). The distribution
is bimodal by quality tier: high S3 for durable brands whose machines survive into old age
(Miele 85.7%, Siemens 75.7%, Bosch 72.2%), and for budget brands whose stock is dominated
by old units never replaced (Indesit 95.2%, Whirlpool 94.2%). This confound is why S3 is
excluded from the composite altogether (§3.3.4) and used only as a corroborating signal
whose external validity is checked directly in §4.4.

---

## 4.3  Hedonic depreciation model (S2)

The pooled hedonic OLS (log price ~ brand + age_old + condition + capacity_std + category +
market; n = 9,059 priced listings; R² = 0.075) shows:

- **age_old = +0.213*** (SE 0.036): old-vintage listings sell for ~24% *more* than
  recent-vintage listings at equal brand, condition, and capacity. This reversal of ordinary
  depreciation is the market-wide demonstrated-survival premium predicted by the
  survivor-selection mechanism (§2.2) and directly supports RQ3. The coefficient has been
  stable (+0.20 to +0.25) across every data revision — wave 1 alone, two waves, and the
  full three-run pool.
- **status_working = −0.061** (p = .005): a small negative composition effect — degraded
  listings are disproportionately large, recent units sold at a discount from new rather
  than end-of-life disposals.
- **market_de = +0.049** (p = .04): German listings are marginally dearer at equal
  composition.
- **capacity_std = +0.144***: capacity is the dominant continuous hedonic attribute where
  parseable (washing machines).

---

## 4.4  External validation: lab tests in four programmes

**Table 2. Spearman correlations: BDP signals × independent test programmes (pooled
data).**

| BDP signal | Test measure | ρ | 95% CI (bootstrap, 5,000) | n | sig |
|---|---|---|---|---|---|
| **S3** | WT handling (inv) | **+0.784** | [+0.397, +0.955] | 13 | ✓ |
| **S3** | WT overall (inv) | **+0.676** | [+0.226, +0.927] | 13 | ✓ |
| **S2_FE** | dTest overall | **+0.668** | [+0.343, +0.817] | 21 | ✓ |
| S2_FE | WT overall (inv) | +0.374 | [−0.248, +0.817] | 13 | n.s. |
| S1 | Which? test score | +0.332 | [−0.274, +0.691] | 14 | n.s. |
| S1 | WT overall (inv) | +0.187 | [−0.504, +0.889] | 13 | n.s. |
| S1 | dTest overall | +0.118 | [−0.355, +0.557] | 21 | n.s. |
| S1 | WT endurance (inv) | −0.101 | [−0.809, +0.562] | 12 | n.s. (predicted, H3) |
| S1/S2/S3 | FR repairability index | |ρ| ≤ 0.19 | all CIs span 0 | 8 | n.s. (predicted, H4) |

*Notes.* WT grades inverted (lower=better → higher=better); "sig" = 95% CI excludes zero.
Sources (§3.5.4–3.5.6): Stiftung Warentest 224 appliance products (endurance sub-rating
exists only for washing machines, 33 products); dTest 896 appliance products (filtered
from 9,073; 8,177 non-appliance records removed); Which? (UK) 1,092 appliance reviews with
test scores; French repairability index (indice de réparabilité, open government data) 428
washing-machine and dishwasher models.

![**Figure 3.** External validation of the two key signals. (a) Old-vintage share S3 against Warentest overall grade (sign-inverted so right = better). (b) Hedonic brand fixed effect S2 against dTest overall score. Both relationships are positive and significant; the Hisense point in panel (b) is the clearest brand-equity outlier.](figures/fig2_validation_scatter.png)

Four findings organise the validation.

**The market's stock composition tracks lab quality.** S3 correlates significantly with
both Warentest overall grade (ρ = +0.68) and its handling sub-grade (ρ = +0.78) across 13
brands — brands that Warentest rates highly are over-represented in the old-vintage segment
of the resale market, exactly the survival-tail signature the theory predicts. These
correlations have been stable across all three data revisions (+0.65 to +0.78) and are the
most robust external validations in the study.

**The market's prices substantially incorporate lab quality.** S2 correlates significantly
with dTest overall scores (ρ = +0.67, n = 21) — the largest-n validation in the matrix,
and one that *strengthened* as data accumulated (wave 1: +0.37 n.s.; two waves: +0.58 ✓;
full pool: +0.67 ✓). Resale price premiums are thus not pure brand equity: at equal age
and condition, the market pays more for brands that independent testing rates higher. The
correlation is nonetheless far from unity, and the largest premium (Hisense, +0.57
log-points) attaches to a mid-table dTest brand (58.1, rank 11 of 21) — brand equity and
quality information coexist in prices. Against the German and UK test programmes the S2
relationship is positive but not significant, which may reflect grade compression
(Warentest) and market mismatch (Which? tests the UK model mix).

**The functional-survival ratio is mechanism-laden, not quality-aligned.** S1 shows no
significant correlation with any of the four test programmes. Its strongest association is
with Which? scores (+0.33, n.s.); its association with dTest, borderline in wave 1
(+0.43), fell monotonically as the sample doubled and then tripled (+0.21, then +0.12).
Most tellingly, S1 is uncorrelated with lab-tested endurance (ρ = −0.10, n = 12) — the
null registered ex ante as H3. Six of the twelve endurance-rated brands received the best
possible endurance grade (1.0: Liebherr, Miele, LG, Samsung, Privileg, Haier), yet their
S1 values span 81.2% (LG) to 90.3% (Liebherr). The mechanism decomposition of §4.5 —
formalised in Appendix A, where a two-parameter selection model reproduces exactly this
pattern — explains why: retention behaviour and repair economics intervene between how long
a machine *can* run and what share of its resale listings still run (Figure 4). S1
therefore functions in the BDP as a *market-condition* signal — a measure of the functional
quality of the circulating stock — rather than as a stand-alone durability estimate.

![**Figure 4.** The mechanism probe: lab-tested endurance (Warentest, washing machines; right = best grade) against the resale-market functional-survival ratio S1. Six brands share the best possible endurance grade yet span nearly the full S1 range — survivor selection (Miele: machines kept until end-of-life) and adverse selection (Bauknecht: early failures dumped broken) shape S1 through opposite channels.](figures/fig3_endurance_mechanism.png)

**The official French repairability index confirms the two-dimensional quality space.**
None of the three BDP signals correlates with the indice de réparabilité (|ρ| ≤ 0.19,
n = 8 brands, all CIs spanning zero) — an independent, *regulatory* replication of the
ORDS orthogonality result (§4.6, hypothesis H4): repairability and market durability are
distinct dimensions, now confirmed with two unrelated repairability data sources.

---

## 4.5  Brand archetypes

The multi-signal design separates four qualitatively distinct patterns (values from Table 1
and the dTest brand means):

**Cluster A — "Survivors" (high S1, S2 ≈ 0, high dTest):** AEG (90.9%, −0.06, 60.4),
Siemens (90.8%, −0.13, 64.1), Liebherr (90.3%, +0.05, 67.8), Bosch (89.7%, 0.00, 61.4).
High functional survival, independently verified quality, but no resale price premium — the
quality is priced into the primary market, not the secondary one. AEG's top S1 despite its
last-place rank in the Warentest owner survey reflects the repair-economics mechanism
(§3.5.3): broken AEG units are discarded rather than listed, positively selecting the
listed stock.

**Cluster B — "Priced equity" (high S2, moderate S1):** Hisense (+0.57, 89.3%, dTest
58.1), Samsung (+0.32, 81.9%, 63.5), Haier (+0.28, 88.8%, 57.4), LG (+0.18, 81.2%,
65.8). Large, significant resale premiums. Given the S2 × dTest correlation, part of this
premium is quality-tracking (Samsung and LG test well); the Hisense premium exceeds what
its test scores support and is the clearest brand-equity residual in the data.

**Cluster C — "Kept-long premium brands" (moderate S1, S2 ≈ 0, high dTest, very high
S3):** Miele (85.3%, +0.07, 65.9, S3 = 85.7%). Lab-excellent (WT endurance 1.0; dTest
65.9, rank 3) and top-ranked by owners, yet mid-table on S1 and premium-free on S2. All
three independent sources (owner survey lifespan 16–18 yr; lab endurance 1.0; ORDS median
repair age 15 yr) point to the same explanation: Miele machines are kept until very late in
life, so the resale market sees few of them while still working, and their high parts value
keeps broken units listed. This is the cleanest survivor-selection signature in the study;
Appendix A's "Miele-like" archetype (λ = 16 yr, release age 13 yr) reproduces it.

**Cluster D — "Double penalty" (low S1, strongly negative S2, low dTest, very high S3):**
Indesit (79.8%, −0.56, 47.7, S3 = 95.2%) and Whirlpool (78.9%, −0.42, 56.2, S3 =
94.2%). Worst or near-worst on every signal simultaneously; their old-stock-dominated S3
reflects stock never replaced rather than stock that survives. The composite places them
a full z-point below the next brand — a gap usable as a screening threshold (§5.6), and
one whose bootstrap CIs do not overlap the mid-field (§4.8).

---

## 4.6  ORDS (Open Repair Data) validation

Comparing S1 to Open Repair Alliance fault-rate proxies (ORDS, 49,994 repair records, 13
common brands) shows Spearman ρ consistently near zero (−0.19 to +0.22, all
non-significant). This is an expected and theoretically informative null: ORDS measures
*repairability* (whether a broken unit is brought in and fixed), not durability (whether a
unit breaks). Together with the French repairability-index nulls of §4.4, two unrelated
repairability sources — one crowd-sourced, one regulatory — both sit orthogonal to the BDP.
The two dimensions span a 2×2 quality space in which all four corners are populated: Bosch
and Siemens are durable and repairable; Hisense and Samsung survive but resist economical
repair; Gorenje breaks but gets fixed (60% ORDS fix rate); Indesit and Whirlpool break
early and are discarded.

---

## 4.7  Cross-border rank consistency (RQ4)

Comparing CZ and DE sub-samples (18 common brands with ≥10 status-classified listings in
each market), Spearman ρ(CZ_S1, DE_S1) = +0.148, 95% CI [−0.481, +0.600]. Notably, more
than doubling the Czech sample (the Sbazar repair) did *not* resolve the problem identified
in earlier revisions: Czech S1 sits at 100% for most brands regardless of sample size,
because Czech sellers — across all three Czech platforms — rarely list appliances described
as broken. The ceiling is therefore structural (a market-culture difference in what gets
listed, or platform moderation of defective-goods ads), not a small-sample artefact.
Within-category S1 ranks correlate significantly between refrigerators and ovens
(ρ = +0.745, CI [+0.342, +0.924], n = 14), with other category pairs positive but not
significant. We treat H2 as unresolved: cross-border validation of S1 requires either a
Czech source with defective-goods listings (e.g., repair-shop auctions) or a price-based
(S2) cross-border comparison, flagged for future work.

---

## 4.8  Robustness

**Wave stability.** The composite ranking is essentially invariant across data revisions:
wave 1 vs two-wave pool ρ = +0.986; two-wave vs full three-run pool ρ = +0.981 (20 common
brands). No brand moves more than two rank positions across revisions, and the top-3 and
bottom-2 sets are identical throughout.

**Cluster-bootstrap confidence intervals.** Resampling listings within brand (S1) and
hedonic observations (S2), B = 1,000, yields 95% CIs for every Table 1 quantity
(replication package, `bootstrap_cis.csv`). The headline separations survive
interval-valued reading: Hisense's composite CI [+1.41, +3.29] lies entirely above the
cross-brand mean; Indesit's [−3.46, −1.11] and Whirlpool's [−2.91, −0.97] lie entirely
below it; the double-penalty cluster's upper bounds do not reach the midfield brands'
point estimates. Mid-table orderings (ranks 4–14) overlap heavily and should not be
over-interpreted — a caution the intervals make explicit.

**Model-tier composition.** A referee may worry that brand fixed effects reflect tier
composition (a brand listing mostly its premium line looks "premium"). For the four brands
whose product lines carry textual markers (Bosch Serie 2–8, Siemens iQ100–800, AEG
6000–9000, Miele W1; 11–35% of their washing-machine listings are taggable), re-estimating
the washing-machine hedonic with tier dummies leaves the brand fixed effects essentially
unchanged: Pearson r between FE vectors with and without tier controls = +0.99, maximum
brand shift 0.13 log-points, no rank crossings among the significant FEs
(`research/tier_analysis.py`). Tier premiums exist (explicit line markers command
significantly higher prices), but they do not masquerade as brand effects.

**Composite-variant robustness.** Adding S3 to the composite (three-signal variant)
correlates with the primary two-signal composite at ρ = +0.71 (n = 21). The divergence is
concentrated precisely where §3.3.3 predicts: the three-signal variant lifts Whirlpool and
Indesit off the bottom (their S3 ≈ 94–95% reflects declining sales, not survival) and
pushes Sharp toward last place (its S3 = 32% reflects recent market entry). That the
confound-carrying variant produces the less face-valid ranking is itself evidence for
excluding S3 from the composite while retaining it as an externally-validated corroborating
signal.

**Market-size independence.** If market size mechanically drove the scores — the concern
that a brand selling 10× more units must look different in resale — signals would correlate
with brand size. We test this both internally and externally. Internally, Spearman ρ between
log listing volume and S1 is +0.36 (CI [−0.15, +0.74]), S3 −0.18 (CI [−0.57, +0.26]), and
the composite +0.19 (CI [−0.31, +0.71]). Externally, against independent installed-base
shares (German washing-machine ownership by brand, Statista Consumer Insights 9/2025,
n = 8,165 — spanning 1% to 16% across our 13 covered brands), ρ with DE washing-machine S1
is +0.48 (CI [−0.12, +0.91]), with S3 +0.24 (CI [−0.37, +0.79]), and with S2 +0.09 (CI
[−0.62, +0.69]). All six CIs span zero. The moderate positive S1 point estimate warrants a
note: the largest German installed bases belong to domestic premium brands (Bosch, Siemens,
AEG, Miele) that independent testing also rates highly, so size and quality are partially
confounded in this market — but under a mechanical size effect the S2 and S3 correlations
would move with it, and they sit at zero. This confirms the self-normalising design property
argued in §3.3.5: market share affects the precision of a brand's signals, not their level.

**What did not replicate.** The wave-1 S1 × dTest correlation (+0.43, borderline) fell to
+0.21 and then +0.12 as the sample tripled, and the wave-1 hedonic working-status
coefficient (−0.16) shrank to −0.06. We report both trajectories explicitly: in a design
with ~20 brand-level observations, individual correlations are fragile, and only findings
that replicate across data revisions — the S3 lab-quality correlations, the S2 × dTest
correlation (which strengthened monotonically), the age premium, the repairability
orthogonality, and the composite ranking itself — carry inferential weight. The wave-3
analysis is pre-registered (replication package) to make this discipline binding.
