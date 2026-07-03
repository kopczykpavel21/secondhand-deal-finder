"""
Model-tier robustness analysis — washing machines only.

Question: do the hedonic brand fixed effects (S2) reflect genuine brand effects,
or tier composition (a brand listing mostly its premium line looks 'premium')?

Approach: parse explicit product-line/tier markers from listing text for the
brands whose line naming is textual and unambiguous:
  Bosch   : "Serie 2/4/6/8"            → tier_high = Serie 6 or 8
  Siemens : "iQ100/300/500/700/800"    → tier_high = iQ500+
  AEG     : "6000/7000/8000/9000" line → tier_high = 8000/9000
  Miele   : "W1" / "WWE/WWD/WCR/WWV"   → tier flag only (W1 = current premium platform)

Then re-estimate the WM-only hedonic with a tier_high dummy and compare brand
FEs with vs without the control.

Usage:  python3 research/tier_analysis.py
"""

import math
import pathlib
import re
import sys

import numpy as np
from scipy import stats as scipy_stats

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from bdp_composite import find_latest_enriched
from hedonic_model import load_listings

TIER_PATTERNS = {
    "Bosch": [
        (re.compile(r"serie?\s*[68]\b", re.I), "high"),
        (re.compile(r"serie?\s*[24]\b", re.I), "low"),
    ],
    "Siemens": [
        (re.compile(r"iq\s*[578]00", re.I), "high"),
        (re.compile(r"iq\s*[13]00", re.I), "low"),
    ],
    "AEG": [
        (re.compile(r"\b[89]000\b"), "high"),
        (re.compile(r"\b[67]000\b"), "low"),
    ],
    "Miele": [
        (re.compile(r"\bW1\b|WW[EDV]\s?\d|WCR\s?\d", re.I), "high"),
    ],
}


def tier_of(brand: str, text: str):
    for pat, tier in TIER_PATTERNS.get(brand, []):
        if pat.search(text):
            return tier
    return None


def ols(X, y):
    n, k = X.shape
    coefs, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ coefs
    ss_res = float(resid @ resid)
    sigma2 = ss_res / max(n - k, 1)
    XtX_inv = np.linalg.inv(X.T @ X + 1e-8 * np.eye(k))
    se = np.sqrt(np.clip(np.diag(sigma2 * XtX_inv), 0, None))
    t = np.where(se > 1e-12, coefs / se, 0.0)
    p = 2 * scipy_stats.t.sf(np.abs(t), df=max(n - k, 1))
    r2 = 1 - ss_res / float(((y - y.mean()) ** 2).sum())
    return coefs, se, p, r2


def build(rows, with_tier: bool):
    from collections import Counter
    counts = Counter(r["brandParsed"] for r in rows)
    brands = sorted(b for b, n in counts.items() if n >= 15 and b != "Bosch")
    feats, ys = [], []
    for r in rows:
        b = r["brandParsed"]
        if b != "Bosch" and b not in brands:
            continue
        price = r.get("priceEur")
        if not price or price <= 0:
            continue
        text = f"{r.get('title','')} {r.get('description','')}"
        tier = tier_of(b, text)
        row = [1.0]
        row += [1.0 if b == bb else 0.0 for bb in brands]
        row.append(1.0 if r.get("ageBandFinal") == "old" else 0.0)
        row.append(1.0 if r.get("functionalStatus") == "working" else 0.0)
        row.append(1.0 if r.get("market") == "de" else 0.0)
        cap = r.get("capacityKg") or 0.0
        row.append(float(cap))
        if with_tier:
            row.append(1.0 if tier == "high" else 0.0)
            row.append(1.0 if tier == "low" else 0.0)
        feats.append(row)
        ys.append(math.log(price))
    X = np.array(feats)
    # standardise capacity where nonzero
    cap_col = X[:, -3 if with_tier else -1]
    nz = cap_col > 0
    if nz.sum() > 10 and cap_col[nz].std() > 1e-9:
        cap_col[nz] = (cap_col[nz] - cap_col[nz].mean()) / cap_col[nz].std()
    X[:, -3 if with_tier else -1] = cap_col
    names = (["intercept"] + brands + ["age_old", "working", "market_de", "cap_std"]
             + (["tier_high", "tier_low"] if with_tier else []))
    return X, np.array(ys), brands, names


def main():
    enriched = find_latest_enriched()
    rows = [r for r in load_listings(enriched, "washing_machine")]
    print(f"Enriched: {enriched.name}  |  WM listings loaded: {len(rows)}")

    # Tier coverage
    from collections import Counter
    cov = Counter()
    for r in rows:
        b = r["brandParsed"]
        if b in TIER_PATTERNS:
            t = tier_of(b, f"{r.get('title','')} {r.get('description','')}")
            cov[(b, t or "none")] += 1
    print("\nTier-marker coverage (WM listings):")
    for b in TIER_PATTERNS:
        tot = sum(v for (bb, _), v in cov.items() if bb == b)
        hi = cov.get((b, "high"), 0); lo = cov.get((b, "low"), 0)
        if tot:
            print(f"  {b:8s}  n={tot:4d}  high={hi:3d}  low={lo:3d}  "
                  f"tagged={100*(hi+lo)/tot:.0f}%")

    X0, y0, brands, names0 = build(rows, with_tier=False)
    X1, y1, _, names1 = build(rows, with_tier=True)
    c0, se0, p0, r2_0 = ols(X0, y0)
    c1, se1, p1, r2_1 = ols(X1, y1)
    print(f"\nWM hedonic without tier: n={len(y0)}, R²={r2_0:.3f}")
    print(f"WM hedonic with tier   : n={len(y1)}, R²={r2_1:.3f}")
    it_h = names1.index("tier_high"); it_l = names1.index("tier_low")
    print(f"  tier_high = {c1[it_h]:+.3f} (p={p1[it_h]:.4f})")
    print(f"  tier_low  = {c1[it_l]:+.3f} (p={p1[it_l]:.4f})")

    print(f"\n{'Brand':12s}  {'FE no-tier':>10s}  {'FE w/ tier':>10s}  {'Δ':>7s}")
    print("─" * 46)
    fes0, fes1 = {}, {}
    for i, b in enumerate(brands, start=1):
        fes0[b], fes1[b] = c0[i], c1[i]
        print(f"{b:12s}  {c0[i]:>+10.3f}  {c1[i]:>+10.3f}  {c1[i]-c0[i]:>+7.3f}")
    common = list(fes0)
    corr = np.corrcoef([fes0[b] for b in common], [fes1[b] for b in common])[0, 1]
    maxd = max(abs(fes1[b] - fes0[b]) for b in common)
    print(f"\nPearson r(FE_no_tier, FE_with_tier) = {corr:+.4f}")
    print(f"Max |ΔFE| across brands            = {maxd:.3f} log-points")


if __name__ == "__main__":
    main()
