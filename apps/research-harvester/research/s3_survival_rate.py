"""
Share-normalised listing rates (Greenspan & Cohen 1999 design) — washing
machines, Germany.

Denominator: brand ownership (installed-base) shares from Statista Consumer
Insights, Sept 2025, n = 8,165 (statistic id998774), stored in
data/market_shares.csv (share_old_pct column). Ownership share is the stock
share — the correct denominator for normalising listing counts.

Rates computed per brand (DE washing-machine listings only):
  listing_rate  = all listings / ownership share      (resale propensity)
  old_rate      = old-vintage listings / ownership share (survival tail)
  broken_rate   = broken listings / ownership share    (failure visibility)
All normalised to cross-brand mean = 1, then rank-correlated with the
Warentest and dTest brand means.

Usage: python3 research/s3_survival_rate.py
"""

import csv
import math
import pathlib
import sys
from collections import defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ords_validation import spearman_r, bootstrap_ci
from bdp_composite import load_enriched, find_latest_enriched
from qualitydb_validation import (load_warentest_appliances, load_dtest_appliances,
                                  brand_agg_warentest, brand_agg_dtest)

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"
SHARES = DATA_DIR / "market_shares.csv"


def load_shares():
    shares = {}
    with open(SHARES) as f:
        for row in csv.DictReader(l for l in f if not l.startswith("#")):
            try:
                shares[row["brand"]] = float(row["share_old_pct"])
            except (ValueError, TypeError, KeyError):
                continue
    return shares


def corr(label, xs, ys, n_min=5):
    if len(xs) < n_min:
        print(f"  {label}: n={len(xs)} — too few")
        return
    rho = spearman_r(xs, ys)
    lo, hi = bootstrap_ci(xs, ys)
    sig = "✓ sig" if lo > 0 or hi < 0 else "n.s."
    print(f"  {label:42s} ρ={rho:+.3f}  [{lo:+.3f},{hi:+.3f}]  n={len(xs)}  {sig}")


def main():
    shares = load_shares()
    if len(shares) < 5:
        print(f"Fill share_old_pct in {SHARES} first.")
        return

    rows = load_enriched(find_latest_enriched())
    counts = defaultdict(lambda: [0, 0, 0])  # all, old, broken — DE WM only
    for r in rows:
        if r.get("market") != "de" or r.get("categoryId") != "washing_machine":
            continue
        b = r.get("brandParsed")
        if b not in shares:
            continue
        c = counts[b]
        c[0] += 1
        if r.get("ageBandFinal") == "old":
            c[1] += 1
        if r.get("functionalStatus") == "broken":
            c[2] += 1

    def normalise(idx):
        raw = {b: counts[b][idx] / shares[b] for b in counts if shares[b] > 0}
        mean = sum(raw.values()) / len(raw)
        return {b: v / mean for b, v in raw.items()}

    lr, orate, br = normalise(0), normalise(1), normalise(2)

    print("Share-normalised listing rates — DE washing machines")
    print(f"(ownership shares: Statista Consumer Insights 9/2025, n=8,165)\n")
    print(f"{'Brand':11s} {'n_list':>6s} {'own%':>5s} {'listing_rate':>12s} {'old_rate':>9s} {'broken_rate':>11s}")
    print("─" * 60)
    for b in sorted(lr, key=lambda x: -lr[x]):
        print(f"{b:11s} {counts[b][0]:>6d} {shares[b]:>5.0f} {lr[b]:>12.2f} "
              f"{orate.get(b, float('nan')):>9.2f} {br.get(b, float('nan')):>11.2f}")

    # External correlations (WM-relevant test measures)
    wt = brand_agg_warentest(load_warentest_appliances())
    wt1 = brand_agg_warentest(load_warentest_appliances(), min_n=1)
    dt = brand_agg_dtest(load_dtest_appliances())

    def paired(rate, ext, key):
        xs, ys = [], []
        for b, v in rate.items():
            m = ext.get(b, {}).get(key)
            if m is not None and not (isinstance(m, float) and math.isnan(m)):
                xs.append(v); ys.append(m)
        return xs, ys

    print("\nCorrelations with test programmes (WT grades sign-inverted):")
    for label, rate in [("listing_rate", lr), ("old_rate", orate), ("broken_rate", br)]:
        xs, ys = paired(rate, wt, "overall_mean")
        corr(f"{label:13s} × WT_overall(inv)", xs, [-y for y in ys])
        xs, ys = paired(rate, wt1, "endurance_mean")
        corr(f"{label:13s} × WT_endurance(inv)", xs, [-y for y in ys])
        xs, ys = paired(rate, dt, "overall_mean")
        corr(f"{label:13s} × dTest_overall", xs, ys)
        print()


if __name__ == "__main__":
    main()
