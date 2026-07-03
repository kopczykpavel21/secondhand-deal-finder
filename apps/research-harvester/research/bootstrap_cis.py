"""
Cluster-bootstrap confidence intervals for the brand-level BDP quantities.

Resamples listings *within brand* (S1, S3) and rows of the pooled hedonic
design matrix (S2), B times, and reports percentile 95% CIs for:
  S1(b), S3(b), S2_FE(b), and the composite BDP_z(b) = z(S1)+z(S2).

Usage:
  python3 research/bootstrap_cis.py                # B=1000, seed 42
  python3 research/bootstrap_cis.py --b 2000 --csv data/bootstrap_cis.csv
"""

import argparse
import json
import math
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from bdp_composite import load_enriched, find_latest_enriched
from hedonic_model import build_design_matrix, load_listings

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"
MIN_STATUS_N = 10


def brand_pools(rows):
    """brand → dict of listing-level arrays needed for S1/S3."""
    pools = {}
    for r in rows:
        b = r.get("brandParsed")
        if not b:
            continue
        p = pools.setdefault(b, {"status": [], "age": []})
        fs = r.get("functionalStatus")
        if fs in ("working", "broken"):
            p["status"].append(1 if fs == "working" else 0)
        ab = r.get("ageBandFinal")
        if ab in ("old", "recent"):
            p["age"].append(1 if ab == "old" else 0)
    return pools


def zscore(d):
    vals = np.array([v for v in d.values() if not math.isnan(v)])
    if len(vals) < 2 or vals.std() == 0:
        return {b: float("nan") for b in d}
    mu, sd = vals.mean(), vals.std()
    return {b: (v - mu) / sd if not math.isnan(v) else float("nan")
            for b, v in d.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--b", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--min-n", type=int, default=100,
                    help="min brand listings for reporting")
    ap.add_argument("--csv", type=pathlib.Path,
                    default=DATA_DIR / "bootstrap_cis.csv")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    enriched = find_latest_enriched()
    print(f"Enriched: {enriched.name}  |  B={args.b}  seed={args.seed}")

    rows = load_enriched(enriched)
    pools = brand_pools(rows)
    brand_n = {b: sum(1 for r in rows if r.get("brandParsed") == b) for b in pools}
    report_brands = sorted(b for b, n in brand_n.items() if n >= args.min_n)

    # Hedonic design matrix (built once; bootstrap resamples its rows)
    hrows = load_listings(enriched, None)
    X, y, feat_names, hb_brands, baseline, _ = build_design_matrix(hrows, "Bosch")
    # feature_names = ["intercept"] + brands_ordered + [controls...]
    hb_set = set(hb_brands)
    brand_idx = {f: i for i, f in enumerate(feat_names) if f in hb_set}
    n_obs = X.shape[0]
    print(f"Hedonic rows: {n_obs}  |  brands with FE: {len(brand_idx)}")

    status_arrays = {b: np.array(p["status"]) for b, p in pools.items()}
    age_arrays = {b: np.array(p["age"]) for b, p in pools.items()}

    draws = {b: {"s1": [], "s3": [], "s2": [], "bdp": []} for b in report_brands}

    for it in range(args.b):
        # S1 / S3: resample within brand
        s1_d, s3_d = {}, {}
        for b in pools:
            st = status_arrays[b]
            if len(st) >= MIN_STATUS_N:
                s1_d[b] = float(rng.choice(st, size=len(st), replace=True).mean())
            else:
                s1_d[b] = float("nan")
            ag = age_arrays[b]
            if len(ag) >= 5:
                s3_d[b] = float(rng.choice(ag, size=len(ag), replace=True).mean())
            else:
                s3_d[b] = float("nan")

        # S2: resample hedonic rows, refit by lstsq
        idx = rng.integers(0, n_obs, size=n_obs)
        coefs, _, _, _ = np.linalg.lstsq(X[idx], y[idx], rcond=None)
        s2_d = {b: float(coefs[i]) for b, i in brand_idx.items()}
        s2_d[baseline] = 0.0

        # Composite on this resample (z within resample)
        zs1, zs2 = zscore(s1_d), zscore(s2_d)
        for b in report_brands:
            draws[b]["s1"].append(s1_d.get(b, float("nan")))
            draws[b]["s3"].append(s3_d.get(b, float("nan")))
            draws[b]["s2"].append(s2_d.get(b, float("nan")))
            z1, z2 = zs1.get(b, float("nan")), zs2.get(b, float("nan"))
            parts = [p for p in (z1, z2) if not math.isnan(p)]
            draws[b]["bdp"].append(sum(parts) if parts else float("nan"))

    def ci(vals):
        arr = np.array([v for v in vals if not math.isnan(v)])
        if len(arr) < 50:
            return (float("nan"), float("nan"))
        return (float(np.percentile(arr, 2.5)), float(np.percentile(arr, 97.5)))

    lines = ["brand,n,s1_lo,s1_hi,s3_lo,s3_hi,s2_lo,s2_hi,bdp_lo,bdp_hi"]
    print(f"\n{'Brand':12s}  {'S1 95% CI':>17s}  {'S2_FE 95% CI':>19s}  {'BDP_z 95% CI':>17s}")
    print("─" * 72)
    order = sorted(report_brands,
                   key=lambda b: -np.nanmedian(np.array(draws[b]["bdp"], dtype=float)))
    for b in order:
        s1lo, s1hi = ci(draws[b]["s1"])
        s3lo, s3hi = ci(draws[b]["s3"])
        s2lo, s2hi = ci(draws[b]["s2"])
        blo, bhi = ci(draws[b]["bdp"])
        lines.append(f"{b},{brand_n[b]},{s1lo:.4f},{s1hi:.4f},{s3lo:.4f},{s3hi:.4f},"
                     f"{s2lo:.4f},{s2hi:.4f},{blo:.4f},{bhi:.4f}")
        def f(lo, hi, fmt=".3f"):
            return "        —" if math.isnan(lo) else f"[{lo:{fmt}},{hi:{fmt}}]"
        print(f"{b:12s}  {f(s1lo,s1hi):>17s}  {f(s2lo,s2hi,'+.3f'):>19s}  {f(blo,bhi,'+.2f'):>17s}")

    args.csv.write_text("\n".join(lines) + "\n")
    print(f"\nCSV → {args.csv}")


if __name__ == "__main__":
    main()
