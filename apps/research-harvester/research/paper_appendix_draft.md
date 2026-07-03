
---

# Appendix A — A minimal selection model of the resale market

## A.1 Setup

We formalise the two selection channels of §2 with three brand-level parameters. A unit of
brand *b*:

- fails at age $T \sim \text{Weibull}(\kappa, \lambda_b)$, where $\lambda_b$ is the brand's
  characteristic life — the quantity laboratory endurance testing measures;
- if still working, is released to the resale market at owner-chosen age
  $R \sim \mathcal{N}(R_b, \sigma_R^2)$ — **retention behaviour**;
- if it fails first (within an ownership horizon $A_{max}$), it is scrapped with probability
  $q_b$ and listed for parts with probability $1 - q_b$ — **repair economics**.

A unit therefore appears as a *working* listing iff $T > R$, and as a *broken* listing with
probability $(1-q_b)$ iff it fails before release. The observable functional-survival ratio
is

$$S_1(b) \;=\; \frac{P(T > R)}{P(T > R) + (1-q_b)\,P(T \le \min(R, A_{max}))}.$$

## A.2 Predictions

Differentiating (numerically; closed forms are unwieldy for Weibull–normal mixtures) yields
three comparative statics that organise the paper's findings:

1. $\partial S_1 / \partial \lambda_b > 0$ *holding $R_b, q_b$ fixed* — more durable brands
   show higher working shares. This is the naive reading of S1.
2. $\partial S_1 / \partial R_b < 0$ — longer retention *lowers* S1 for any $\lambda_b$: a
   brand whose owners keep working machines until near end-of-life starves the market of
   working listings. For $R_b$ approaching $\lambda_b$, S1 falls steeply.
3. $\partial S_1 / \partial q_b > 0$ — a brand whose broken units are scrapped rather than
   listed shows a *higher* S1 at identical reliability: positive selection out of the broken
   pool.

Because (2) and (3) can each move S1 by more than plausible cross-brand variation in
$\lambda_b$ moves it, the model predicts that **S1 and lab endurance need not correlate
across brands** (hypothesis H3) unless retention and repair economics are uniform — which
§3.5.3's evidence (Miele lifespans, AEG repair costs) shows they are not.

## A.3 Simulation

Monte Carlo implementation (`research/selection_model_sim.py`; 200,000 units per archetype,
$\kappa = 1.8$, $A_{max} = 25$, seed 42) with five brand archetypes chosen to mirror the
empirical clusters of §4.5:

| Archetype | λ (life, yr) | R (release, yr) | q (scrap) | simulated S1 |
|---|---|---|---|---|
| Durable, released early ("Bosch-like") | 14 | 7 | 0.50 | 85% |
| Durable, kept until death ("Miele-like") | 16 | 13 | 0.30 | 59% |
| Durable, growing entrant ("Hisense-like") | 13 | 5 | 0.70 | 94% |
| Fragile, broken units listed ("Bauknecht-like") | 9 | 7 | 0.30 | 62% |
| Fragile, broken units scrapped ("budget-like") | 8 | 7 | 0.80 | 82% |

Across the five archetypes, the correlation between lab durability $\lambda$ and simulated
S1 is −0.05: the *most durable* archetype (Miele-like) produces one of the *lowest* working
shares, and a fragile brand with aggressive scrapping out-scores it. The empirical
S1 × endurance null of §4.4 is therefore not a validation failure but the model's central
prediction.

![**Figure A1.** Simulated S1 as a function of mean release age R, for three values of characteristic life λ (scrap probability fixed at 0.5). At any λ, moving release age from 5 to 15 years moves S1 by more than the entire cross-brand range of plausible λ differences — retention behaviour dominates the working share.](figures/fig5_selection_model.png)

## A.4 What the model implies for measurement

The model clarifies which market statistics identify what. S1 identifies a *composite* of
$(\lambda_b, R_b, q_b)$ — effective market durability (§5.3). S3, in contrast, conditions on
units that were *listed at all* and asks how old they are; in the model, the old-band share
rises with $\lambda_b$ under any $(R_b, q_b)$ as long as the brand's sales history is stable
(the trend confound of §3.3.3). This is why S3, not S1, is the signal that correlates with
laboratory quality in §4.4, and why the composite deliberately weights the two signals that
carry price and stock-composition information rather than the mechanism-laden working share
alone. Separating $\lambda_b$ from $(R_b, q_b)$ empirically requires panel data (time-on-
market and delisting outcomes) — the extension of §5.7.
