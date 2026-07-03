"""
Brand Durability Proxy (BDP) — Composite score computation

Combines three signals into a final BDP score:

  BDP = z(S1) + z(S2) + z(S3)

  S1 — Functional-survival ratio: working / (working + broken) per brand [primary]
  S2 — Residual-value retention: brand fixed effect from hedonic model [primary]
  S3 — Survival-tail: pre-2021-vintage share of age-banded listings [corroborating]

  z-scores computed cross-brand, equal weights (sensitivity analysis: S1+S2 only).

Outputs:
  - Per-brand BDP table (all signals + composite)
  - Cross-border rank correlation (CZ vs DE S1 ranks, Spearman ρ)
  - S1 × S2 scatter description (discordance analysis)
  - Cross-category S1 stability (Spearman ρ between categories)

Usage:
  python research/bdp_composite.py
  python research/bdp_composite.py --enriched data/enriched/enriched_harvest_X.jsonl
"""

import json
import math
import pathlib
import argparse
from collections import defaultdict
from typing import Optional

# Reuse stats helpers
import sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ords_validation import spearman_r, bootstrap_ci

# ── Configuration ──────────────────────────────────────────────────────────────

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"
MIN_BRAND_N = 20      # min total relevant listings for a brand to be scored
MIN_STATUS_N = 10     # min status-known listings for S1
CATEGORIES = ["washing_machine", "dishwasher", "fridge", "oven", "dryer"]

# ── Loaders ────────────────────────────────────────────────────────────────────

def _jsonl_safe(text: str) -> str:
    # U+2028/U+2029 are valid in ES2019 JSON strings but break line-based parsers.
    return text.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def find_latest_enriched() -> pathlib.Path:
    enriched_dir = DATA_DIR / "enriched"
    files = sorted(enriched_dir.glob("enriched_harvest_*.jsonl"), reverse=True)
    if not files:
        raise FileNotFoundError("No enriched JSONL found. Run enrich first.")
    return files[0]

def load_enriched(path: pathlib.Path) -> list[dict]:
    raw = path.read_text(encoding="utf-8")
    rows = []
    for line in _jsonl_safe(raw).splitlines():
        line = line.strip()
        if not line:
            continue
        e = json.loads(line)
        if e.get("isRelevant") and e.get("brandParsed"):
            rows.append(e)
    return rows

# ── BDP signal computation ─────────────────────────────────────────────────────

def compute_s1_s3(rows: list[dict], market: Optional[str] = None) -> dict:
    """
    Per-brand S1 and S3 (optionally filtered by market).
    Returns: brand → {n, s1, s3, n_status, n_age, prices}
    """
    stats = defaultdict(lambda: dict(
        n=0, nw=0, nb=0, nd=0, ns=0,  # n, working, broken, degraded, status_known
        no=0, nr=0, na=0,              # old, recent, age_banded
        prices=[],
    ))
    for e in rows:
        if market and e.get("market") != market:
            continue
        b = e["brandParsed"]
        s = stats[b]
        s["n"] += 1
        fs = e.get("functionalStatus")
        if fs == "working":   s["nw"] += 1; s["ns"] += 1
        elif fs == "broken":  s["nb"] += 1; s["ns"] += 1
        elif fs == "degraded":s["nd"] += 1; s["ns"] += 1
        ab = e.get("ageBandFinal")
        if ab == "old":   s["no"] += 1; s["na"] += 1
        elif ab == "recent": s["nr"] += 1; s["na"] += 1
        p = e.get("priceEur")
        if p is not None:
            s["prices"].append(p)

    result = {}
    for b, s in stats.items():
        if s["n"] < MIN_BRAND_N:
            continue
        wb = s["nw"] + s["nb"]
        result[b] = {
            "n":     s["n"],
            "s1":    s["nw"] / wb if wb >= MIN_STATUS_N else float("nan"),
            "s3":    s["no"] / s["na"] if s["na"] >= 5 else float("nan"),
            "n_status": s["ns"],
            "n_age": s["na"],
            "med_price": _median(s["prices"]) if s["prices"] else float("nan"),
        }
    return result

def _median(vals: list) -> float:
    s = sorted(v for v in vals if not math.isnan(v))
    if not s:
        return float("nan")
    n = len(s)
    return s[n // 2]

def _zscore(vals: dict[str, float]) -> dict[str, float]:
    """Z-score a {brand: value} dict (skip NaN brands)."""
    clean = {b: v for b, v in vals.items() if not math.isnan(v)}
    if len(clean) < 2:
        return {b: float("nan") for b in vals}
    mu = sum(clean.values()) / len(clean)
    sd = math.sqrt(sum((v - mu) ** 2 for v in clean.values()) / len(clean))
    if sd == 0:
        return {b: 0.0 for b in vals}
    return {b: (v - mu) / sd for b, v in vals.items()}

def compute_bdp(s1: dict, s2_fe: Optional[dict] = None, s3: Optional[dict] = None) -> dict:
    """
    Combine S1, S2, S3 into composite BDP = z(S1) + z(S2) + z(S3).
    S2 and S3 are optional (returns partial composite if absent).
    """
    all_brands = set(s1.keys())
    zs1 = _zscore({b: s1[b].get("s1", float("nan")) for b in all_brands})

    zs2 = {b: float("nan") for b in all_brands}
    if s2_fe:
        zs2 = _zscore({b: s2_fe.get(b, {}).get("fe", float("nan")) for b in all_brands})

    zs3 = {b: float("nan") for b in all_brands}
    if s3:
        zs3 = _zscore({b: s3.get(b, float("nan")) for b in all_brands})

    result = {}
    for b in all_brands:
        parts = [zs1.get(b, float("nan")), zs2.get(b, float("nan")), zs3.get(b, float("nan"))]
        non_nan = [p for p in parts if not math.isnan(p)]
        bdp = sum(non_nan) if non_nan else float("nan")
        result[b] = {
            "bdp": bdp, "n_signals": len(non_nan),
            "zs1": parts[0], "zs2": parts[1], "zs3": parts[2],
        }
    return result

# ── Cross-border analysis (RQ4) ───────────────────────────────────────────────

def cross_border_analysis(rows: list[dict]) -> None:
    print("\n━━━ Cross-border rank correlation (RQ4) ━━━")
    cz = compute_s1_s3(rows, market="cz")
    de = compute_s1_s3(rows, market="de")
    common = sorted(b for b in cz if b in de
                    and not math.isnan(cz[b]["s1"]) and not math.isnan(de[b]["s1"])
                    and cz[b]["n_status"] >= MIN_STATUS_N and de[b]["n_status"] >= MIN_STATUS_N)
    print(f"Common brands with sufficient status data in both markets: {len(common)}")
    if len(common) < 4:
        print("  Too few — run full harvest first.")
        return

    x = [cz[b]["s1"] for b in common]
    y = [de[b]["s1"] for b in common]
    r = spearman_r(x, y)
    lo, hi = bootstrap_ci(x, y)

    print(f"\n{'Brand':14s}  {'CZ_S1':>8s}  {'DE_S1':>8s}")
    print("─" * 36)
    for b in sorted(common, key=lambda b: -cz[b]["s1"]):
        print(f"{b:14s}  {cz[b]['s1']:>8.1%}  {de[b]['s1']:>8.1%}")

    print(f"\nSpearman ρ(CZ_S1, DE_S1) = {r:+.3f}  95% CI [{lo:+.3f}, {hi:+.3f}]  n={len(common)}")
    if lo > 0:
        print("→ Brand S1 ranks are CONSISTENT across CZ and DE markets ✓ (H2 supported)")
    else:
        print("→ Cross-border rank consistency unclear (widen CI with full harvest)")

# ── Cross-category S1 stability ────────────────────────────────────────────────

def cross_category_analysis(rows: list[dict]) -> None:
    print("\n━━━ Cross-category S1 stability ━━━")
    by_cat = defaultdict(list)
    for e in rows:
        by_cat[e.get("categoryId", "")].append(e)

    cat_s1 = {}
    for cat, cat_rows in by_cat.items():
        s = compute_s1_s3(cat_rows)
        cat_s1[cat] = {b: v["s1"] for b, v in s.items() if not math.isnan(v["s1"])}

    cats = [c for c in CATEGORIES if c in cat_s1 and len(cat_s1[c]) >= 4]
    if len(cats) < 2:
        print("  Fewer than 2 categories with sufficient data — run full harvest.")
        return

    print(f"Categories with data: {', '.join(cats)}")
    for i in range(len(cats)):
        for j in range(i + 1, len(cats)):
            c1, c2 = cats[i], cats[j]
            common = sorted(b for b in cat_s1[c1] if b in cat_s1[c2])
            if len(common) < 4:
                continue
            x = [cat_s1[c1][b] for b in common]
            y = [cat_s1[c2][b] for b in common]
            r = spearman_r(x, y)
            lo, hi = bootstrap_ci(x, y)
            print(f"  ρ({c1[:12]}, {c2[:12]}) = {r:+.3f}  [{lo:+.3f}, {hi:+.3f}]  n={len(common)}")

# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--enriched", type=pathlib.Path, default=None)
    parser.add_argument("--s2-json", type=pathlib.Path, default=None,
                        help="JSON file with brand → FE from hedonic_model.py (optional)")
    args = parser.parse_args()

    enriched_path = args.enriched or find_latest_enriched()
    print(f"━━━ BDP Composite Score ━━━")
    print(f"Source: {enriched_path.name}\n")

    rows = load_enriched(enriched_path)
    print(f"Relevant listings: {len(rows)}")

    # Full dataset S1/S3
    full = compute_s1_s3(rows)
    brands = sorted(full.keys(), key=lambda b: -(full[b]["s1"] if not math.isnan(full[b]["s1"]) else -1))

    # S2 from JSON (if provided)
    s2_fe = None
    if args.s2_json and args.s2_json.exists():
        s2_fe = json.loads(args.s2_json.read_text())

    bdp = compute_bdp(full, s2_fe=s2_fe)

    # ── Main BDP table ─────────────────────────────────────────────────────────
    print("\n━━━ BDP signals (all categories pooled) ━━━")
    SEP = "─" * 95
    print(SEP)
    print(f"{'Brand':14s}  {'n':>5s}  {'S1':>7s}  {'S1_n':>6s}  "
          f"{'S3':>7s}  {'S3_n':>6s}  {'med€':>7s}  {'BDP_z':>7s}  {'rank':>5s}")
    print(SEP)
    scored = sorted((b for b in brands if not math.isnan(bdp[b]["bdp"])),
                    key=lambda b: -bdp[b]["bdp"])
    for rank, b in enumerate(scored, 1):
        v = full[b]
        bv = bdp[b]
        s3_str = f"{v['s3']:>6.1%}" if not math.isnan(v["s3"]) else "    —  "
        print(
            f"{b:14s}  {v['n']:>5d}  "
            f"{v['s1']:>6.1%}  {v['n_status']:>6d}  "
            f"{s3_str}  {v['n_age']:>6d}  "
            f"{v['med_price']:>7.0f}  "
            f"{bv['bdp']:>+7.3f}  {rank:>5d}"
        )
    print(SEP)

    # Also show unscored brands (S1 data insufficient)
    unscored = [b for b in brands if math.isnan(bdp[b]["bdp"]) or bdp[b]["n_signals"] == 0]
    if unscored:
        print(f"\nBrands with insufficient status data for BDP: {', '.join(unscored)}")

    # ── Cross-border (RQ4) ─────────────────────────────────────────────────────
    cross_border_analysis(rows)

    # ── Cross-category stability ───────────────────────────────────────────────
    cross_category_analysis(rows)

    # ── S1 × S2 discordance note ───────────────────────────────────────────────
    print("\n━━━ S1 / S2 discordance note ━━━")
    print("Run hedonic_model.py for S2 brand fixed effects, then re-run:")
    print("  python research/bdp_composite.py --s2-json data/s2_fe.json")

if __name__ == "__main__":
    main()
