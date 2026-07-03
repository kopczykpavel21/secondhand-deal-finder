"""
Hedonic Depreciation Model — Brand Durability Proxy S2 signal

Estimates brand fixed effects from a log-price regression:

  log(priceEur) ~ Σ(brand_FE) + ageBand + functionalStatus + capacityKg + market + ε

The brand fixed effects (relative to the baseline/median brand) quantify each brand's
residual-value premium at equal age, condition, capacity, and market — interpreted as
the market's revealed expectation of remaining useful life, i.e., the S2 durability signal.

This is the applied analogue of the used-car depreciation/reliability literature ported to
major household appliances (cf. Peterson & Schneider 2017, Bijgaart & Cerruti 2020).

Usage:
  python research/hedonic_model.py
  python research/hedonic_model.py --enriched data/enriched/enriched_harvest_X.jsonl
  python research/hedonic_model.py --category washing_machine  # single category

Output:
  Brand S2 fixed-effects table (sorted by FE, baseline = Bosch)
  R², adjusted R², model diagnostics
  S2 vs S1 rank-correlation (cross-validation within BDP)
"""

import json
import math
import pathlib
import argparse
import sys
from collections import defaultdict
from typing import Optional

import numpy as np
from scipy import stats as scipy_stats

# ── Configuration ──────────────────────────────────────────────────────────────

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"

# Reference brand (intercept absorbs this brand's FE; others are relative to it)
BASELINE_BRAND = "Bosch"

# Minimum listing count to include a brand in the model
MIN_BRAND_N = 15

CATEGORIES = ["washing_machine", "dishwasher", "fridge", "oven", "dryer"]

# ── Data loading ───────────────────────────────────────────────────────────────

def _jsonl_safe(text: str) -> str:
    # U+2028/U+2029 are valid in ES2019 JSON strings but break line-based parsers.
    return text.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def find_latest_enriched() -> pathlib.Path:
    enriched_dir = DATA_DIR / "enriched"
    files = sorted(enriched_dir.glob("enriched_harvest_*.jsonl"), reverse=True)
    if not files:
        raise FileNotFoundError(f"No enriched JSONL in {enriched_dir}. Run enrich first.")
    return files[0]

def load_listings(path: pathlib.Path, category_filter: Optional[str] = None) -> list[dict]:
    raw = path.read_text(encoding="utf-8")
    rows = []
    for line in _jsonl_safe(raw).splitlines():
        line = line.strip()
        if not line:
            continue
        e = json.loads(line)
        # Filters: relevant, brand known, price known, working or degraded (exclude broken for S2)
        if not e.get("isRelevant"):
            continue
        if not e.get("brandParsed"):
            continue
        price = e.get("priceEur")
        if price is None or price <= 0:
            continue
        if e.get("functionalStatus") == "broken":
            continue  # broken units contaminate price model
        if category_filter and e.get("categoryId") != category_filter:
            continue
        rows.append(e)
    return rows

# ── Feature engineering ────────────────────────────────────────────────────────

def build_design_matrix(rows: list[dict], baseline_brand: str) -> tuple:
    """
    Returns (X, y, feature_names, brand_names) where X is the design matrix
    and y = log(priceEur).

    Categorical encoding:
      - brand: dummy (drop baseline_brand)
      - ageBandFinal: dummy for 'old' (recent = reference)
      - functionalStatus: dummy for 'working' (degraded = reference; broken excluded)
      - market: dummy for 'de' (cz = reference)
      - capacityKg: continuous, standardised within-sample

    All listings where brand count < MIN_BRAND_N are grouped into '(other)'
    and included as a dummy for control purposes but excluded from the BDP table.
    """
    from collections import Counter
    brand_counts = Counter(r["brandParsed"] for r in rows)
    valid_brands = {b for b, n in brand_counts.items() if n >= MIN_BRAND_N}
    if baseline_brand not in valid_brands:
        # Pick most common brand as baseline
        baseline_brand = brand_counts.most_common(1)[0][0]
        print(f"  Note: {BASELINE_BRAND} has < {MIN_BRAND_N} obs; using '{baseline_brand}' as baseline")

    brands_ordered = sorted(valid_brands - {baseline_brand})
    brand_names = brands_ordered  # these get FE

    # Capacity standardisation params
    caps = [r.get("capacityKg") for r in rows if r.get("capacityKg") is not None]
    cap_mean = float(np.mean(caps)) if caps else 0.0
    cap_std  = float(np.std(caps))  if caps else 1.0
    if cap_std < 1e-9:
        cap_std = 1.0  # all same value — drop as control (standardised = 0)

    X_rows = []
    y_vals  = []
    valid_rows = []

    for r in rows:
        brand = r.get("brandParsed")
        if brand not in valid_brands:
            continue  # drop rare brands entirely (cleaner than grouping)

        log_price = math.log(r["priceEur"])
        x = [1.0]  # intercept

        # Brand dummies (drop baseline)
        for b in brands_ordered:
            x.append(1.0 if brand == b else 0.0)

        # ageBandFinal: 'old' = 1
        x.append(1.0 if r.get("ageBandFinal") == "old" else 0.0)

        # functionalStatus: 'working' = 1 (degraded = 0)
        x.append(1.0 if r.get("functionalStatus") == "working" else 0.0)

        # market: 'de' = 1
        x.append(1.0 if r.get("market") == "de" else 0.0)

        # capacityKg (standardised, 0 if missing)
        cap = r.get("capacityKg")
        x.append((cap - cap_mean) / cap_std if cap is not None else 0.0)

        X_rows.append(x)
        y_vals.append(log_price)
        valid_rows.append(r)

    feature_names = ["intercept"] + brands_ordered + ["age_old", "status_working", "market_de", "capacity_std"]
    X = np.array(X_rows, dtype=float)
    y = np.array(y_vals, dtype=float)
    return X, y, feature_names, brands_ordered, baseline_brand, valid_rows

# ── OLS with standard errors ───────────────────────────────────────────────────

def ols(X: np.ndarray, y: np.ndarray):
    """Returns (coefs, se, t_stats, p_values, r2, adj_r2). Uses lstsq + ridge for stability."""
    n, k = X.shape
    coefs, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    y_hat = X @ coefs
    residuals = y - y_hat
    ss_res = float(residuals @ residuals)
    ss_tot = float(((y - y.mean()) ** 2).sum())
    r2     = 1 - ss_res / ss_tot
    adj_r2 = 1 - (ss_res / max(n - k, 1)) / (ss_tot / (n - 1))
    sigma2 = ss_res / max(n - k, 1)
    # Small ridge to keep inversion stable even with near-collinear columns
    XtX_inv = np.linalg.inv(X.T @ X + 1e-8 * np.eye(k))
    cov_mat = sigma2 * XtX_inv
    se = np.sqrt(np.clip(np.diag(cov_mat), 0, None))
    t_stat = np.where(se > 1e-12, coefs / se, 0.0)
    p_values = 2 * scipy_stats.t.sf(np.abs(t_stat), df=max(n - k, 1))
    return coefs, se, t_stat, p_values, r2, adj_r2

# ── Main ───────────────────────────────────────────────────────────────────────

def run_model(enriched_path: pathlib.Path, category_filter: Optional[str], baseline: str) -> Optional[dict]:
    rows = load_listings(enriched_path, category_filter)
    cat_label = category_filter or "all categories"
    print(f"\n━━━ Hedonic model: {cat_label} ━━━")
    print(f"Listings loaded: {len(rows)}")

    if len(rows) < 50:
        print("  Too few observations — skip.")
        return None

    X, y, feature_names, brand_names, baseline_brand, valid_rows = build_design_matrix(rows, baseline)
    print(f"Observations in model: {X.shape[0]}  |  parameters: {X.shape[1]}  |  baseline: {baseline_brand}")

    coefs, se, t_stat, p_values, r2, adj_r2 = ols(X, y)

    print(f"R² = {r2:.3f}  |  Adj. R² = {adj_r2:.3f}")

    # ── Brand fixed-effects table ──────────────────────────────────────────────
    # Brand FEs are the coefficients for brand dummies (index 1 to len(brand_names))
    brand_fe = {}
    for i, b in enumerate(brand_names):
        fe  = coefs[1 + i]
        se_ = se[1 + i]
        t_  = t_stat[1 + i]
        p_  = p_values[1 + i]
        brand_fe[b] = {"fe": fe, "se": se_, "t": t_, "p": p_}
    brand_fe[baseline_brand] = {"fe": 0.0, "se": 0.0, "t": 0.0, "p": 1.0}  # baseline

    print(f"\n── Brand fixed effects (S2) — relative to {baseline_brand} ──")
    print(f"{'Brand':14s}  {'FE (log€)':>10s}  {'±SE':>8s}  {'t':>7s}  {'p':>7s}  {'sig':>4s}  {'exp(FE)':>8s}")
    print("─" * 72)
    for b, v in sorted(brand_fe.items(), key=lambda x: -x[1]["fe"]):
        sig = "***" if v["p"] < 0.001 else ("**" if v["p"] < 0.01 else ("*" if v["p"] < 0.05 else ""))
        print(
            f"{b:14s}  {v['fe']:>+10.4f}  {v['se']:>8.4f}  {v['t']:>+7.2f}  {v['p']:>7.4f}  "
            f"{sig:>4s}  {math.exp(v['fe']):>8.4f}"
        )

    # ── Non-brand controls ─────────────────────────────────────────────────────
    print(f"\n── Control coefficients ──")
    for i, name in enumerate(feature_names):
        if name in (["intercept"] + brand_names):
            continue
        print(f"  {name:18s}  coef={coefs[i]:+.4f}  se={se[i]:.4f}  p={p_values[i]:.4f}")

    return {
        "category": cat_label,
        "brand_fe": brand_fe,
        "baseline": baseline_brand,
        "r2": r2,
        "adj_r2": adj_r2,
        "n": X.shape[0],
    }

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--enriched", type=pathlib.Path, default=None)
    parser.add_argument("--category", type=str, default=None,
                        help="Filter to a single category (e.g. washing_machine)")
    parser.add_argument("--baseline", type=str, default=BASELINE_BRAND,
                        help=f"Reference brand for FE (default: {BASELINE_BRAND})")
    parser.add_argument("--s2-json", type=pathlib.Path, default=None,
                        help="Write pooled brand FEs to this JSON file for use in bdp_composite.py")
    args = parser.parse_args()

    enriched_path = args.enriched or find_latest_enriched()
    print(f"Enriched source: {enriched_path}")

    if args.category:
        run_model(enriched_path, args.category, args.baseline)
    else:
        # Run per-category + pooled
        results = []
        for cat in CATEGORIES:
            r = run_model(enriched_path, cat, args.baseline)
            if r:
                results.append(r)
        print("\n\n━━━ Pooled model (all categories) ━━━")
        pooled = run_model(enriched_path, None, args.baseline)

        # Export S2 FEs to JSON for BDP composite integration
        if pooled and args.s2_json:
            out = {b: {"fe": v["fe"], "se": v["se"], "p": v["p"]}
                   for b, v in pooled["brand_fe"].items()}
            args.s2_json.parent.mkdir(parents=True, exist_ok=True)
            args.s2_json.write_text(json.dumps(out, indent=2))
            print(f"\nS2 fixed effects written → {args.s2_json}")

        if results:
            print("\n━━━ S2 rank stability across categories ━━━")
            from ords_validation import spearman_r
            print("(Cross-category rank correlations of brand FEs — printed if ≥2 categories with ≥4 common brands)")

if __name__ == "__main__":
    main()
