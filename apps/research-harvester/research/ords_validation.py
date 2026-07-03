"""
ORDS External Validation — Brand Durability Proxy (BDP) vs Open Repair Alliance data

Validates the market-derived BDP signals (S1, S3) against independent repair data
from the Open Repair Alliance ORDS v0.3 (2025/07 release, CC BY-SA 4.0).

Input:
  ../data/ords/ords_appliances_202507.csv   — filtered ORDS (Large home electrical)
  ../data/enriched/enriched_harvest_*.jsonl  — latest enriched harvest

Output:
  Spearman correlation table (BDP signals vs ORDS metrics) with bootstrap CIs
  Console table + optional CSV for paper tables

Usage:
  python research/ords_validation.py
  python research/ords_validation.py --enriched data/enriched/enriched_harvest_X.jsonl
"""

import csv
import json
import math
import pathlib
import random
import sys
import argparse
from collections import defaultdict, Counter
from typing import Optional

# ── Configuration ──────────────────────────────────────────────────────────────

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"
ORDS_CSV  = DATA_DIR / "ords" / "ords_appliances_202507.csv"

BRANDS = {
    "Bosch", "Siemens", "Miele", "AEG", "Electrolux", "Whirlpool", "Beko",
    "Samsung", "LG", "Gorenje", "Candy", "Indesit", "Zanussi", "Bauknecht",
    "Privileg", "Hoover", "Haier", "Hisense", "Sharp", "Liebherr",
    "Mora", "Philco", "ETA", "Concept", "Romo",
}
BRAND_NORM = {b.lower(): b for b in BRANDS}

# Minimum ORDS records per brand to include in correlation (exclude n < MIN_ORDS)
MIN_ORDS_N = 10
# Minimum secondhand listings per brand
MIN_BDP_N = 20
# Bootstrap iterations for CI
N_BOOTSTRAP = 5_000
RANDOM_SEED = 42

# ── ORDS loading ───────────────────────────────────────────────────────────────

def normalize_brand(raw: str) -> Optional[str]:
    """Fuzzy match raw brand string to canonical brand name."""
    r = raw.strip().lower()
    if not r:
        return None
    for norm, canonical in BRAND_NORM.items():
        if len(norm) >= 3 and (norm in r or r == norm):
            return canonical
    return None

def load_ords(path: pathlib.Path) -> dict:
    """
    Returns dict: brand → {
        n, n_fixed, n_eol, n_repairable, n_unknown,
        repair_rate, eol_rate, fix_rate, ages: [float]
    }
    Only Large home electrical category.
    """
    stats = defaultdict(lambda: dict(n=0, n_fixed=0, n_eol=0, n_repairable=0, ages=[]))
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("product_category") != "Large home electrical":
                continue
            brand = normalize_brand(row.get("brand", ""))
            if not brand:
                continue
            s = stats[brand]
            s["n"] += 1
            status = row.get("repair_status", "").strip()
            if status == "Fixed":
                s["n_fixed"] += 1
            elif status == "End of life":
                s["n_eol"] += 1
            elif status == "Repairable":
                s["n_repairable"] += 1
            try:
                age = float(row.get("product_age", "").strip())
                if 0 < age < 50:
                    s["ages"].append(age)
            except (ValueError, AttributeError):
                pass

    result = {}
    for brand, s in stats.items():
        n = s["n"]
        if n < MIN_ORDS_N:
            continue
        result[brand] = {
            "n": n,
            "fix_rate":    s["n_fixed"] / n,
            "eol_rate":    s["n_eol"]   / n,
            "repair_rate": (s["n_fixed"] + s["n_repairable"]) / n,
            "med_age":     _median(s["ages"]) if s["ages"] else float("nan"),
            "n_with_age":  len(s["ages"]),
        }
    return result

# ── Enriched harvest loading ───────────────────────────────────────────────────

def find_latest_enriched() -> pathlib.Path:
    enriched_dir = DATA_DIR / "enriched"
    files = sorted(enriched_dir.glob("enriched_harvest_*.jsonl"), reverse=True)
    if not files:
        raise FileNotFoundError(f"No enriched_harvest_*.jsonl in {enriched_dir}")
    return files[0]

def _jsonl_safe(text: str) -> str:
    # U+2028/U+2029 are valid in ES2019 JSON strings but break line-based parsers.
    return text.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def load_bdp(path: pathlib.Path) -> dict:
    """
    Returns dict: brand → {
        n, n_working, n_broken, n_degraded, n_status_known,
        n_old, n_recent, n_age_banded,
        s1, s3, prices_eur: [float]
    }
    Only isRelevant=True listings.
    """
    stats = defaultdict(lambda: dict(
        n=0, n_working=0, n_broken=0, n_degraded=0, n_status_known=0,
        n_old=0, n_recent=0, n_age_banded=0, prices_eur=[],
    ))
    raw = path.read_text(encoding="utf-8")
    for line in _jsonl_safe(raw).splitlines():
        line = line.strip()
        if not line:
            continue
        e = json.loads(line)
        if not e.get("isRelevant"):
            continue
        brand = e.get("brandParsed")
        if not brand:
            continue
        s = stats[brand]
        s["n"] += 1
        fs = e.get("functionalStatus")
        if fs == "working":
            s["n_working"] += 1; s["n_status_known"] += 1
        elif fs == "broken":
            s["n_broken"] += 1;  s["n_status_known"] += 1
        elif fs == "degraded":
            s["n_degraded"] += 1; s["n_status_known"] += 1
        ab = e.get("ageBandFinal")
        if ab == "old":
            s["n_old"] += 1; s["n_age_banded"] += 1
        elif ab == "recent":
            s["n_recent"] += 1; s["n_age_banded"] += 1
        p = e.get("priceEur")
        if p is not None:
            s["prices_eur"].append(p)

    result = {}
    for brand, s in stats.items():
        if s["n"] < MIN_BDP_N:
            continue
        wb = s["n_working"] + s["n_broken"]  # S1 denominator
        result[brand] = {
            "n": s["n"],
            "s1": s["n_working"] / wb if wb > 0 else float("nan"),
            "s3": s["n_old"] / s["n_age_banded"] if s["n_age_banded"] > 0 else float("nan"),
            "n_status_known": s["n_status_known"],
            "n_age_banded":   s["n_age_banded"],
            "med_price_eur":  _median(s["prices_eur"]) if s["prices_eur"] else float("nan"),
        }
    return result

# ── Statistics ─────────────────────────────────────────────────────────────────

def _median(vals: list) -> float:
    s = sorted(vals)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2

def _rank(vals: list) -> list:
    """Return rank list (average ranks for ties)."""
    indexed = sorted(enumerate(vals), key=lambda x: x[1])
    ranks = [0.0] * len(vals)
    i = 0
    while i < len(indexed):
        j = i
        while j < len(indexed) - 1 and indexed[j + 1][1] == indexed[i][1]:
            j += 1
        r = (i + j + 2) / 2  # average rank (1-indexed)
        for k in range(i, j + 1):
            ranks[indexed[k][0]] = r
        i = j + 1
    return ranks

def spearman_r(x: list, y: list) -> float:
    """Spearman rank correlation."""
    assert len(x) == len(y) and len(x) >= 3
    rx, ry = _rank(x), _rank(y)
    n = len(rx)
    mx = sum(rx) / n
    my = sum(ry) / n
    num = sum((rx[i] - mx) * (ry[i] - my) for i in range(n))
    dx  = math.sqrt(sum((v - mx) ** 2 for v in rx))
    dy  = math.sqrt(sum((v - my) ** 2 for v in ry))
    return num / (dx * dy) if dx * dy > 0 else 0.0

def bootstrap_ci(x: list, y: list, n_boot: int = N_BOOTSTRAP, seed: int = RANDOM_SEED):
    """Bootstrap 95% CI for Spearman r."""
    rng = random.Random(seed)
    n = len(x)
    boot_r = []
    for _ in range(n_boot):
        idx = [rng.randint(0, n - 1) for _ in range(n)]
        bx = [x[i] for i in idx]
        by = [y[i] for i in idx]
        try:
            boot_r.append(spearman_r(bx, by))
        except Exception:
            pass
    boot_r.sort()
    lo = boot_r[int(0.025 * len(boot_r))]
    hi = boot_r[int(0.975 * len(boot_r))]
    return lo, hi

# ── Main analysis ──────────────────────────────────────────────────────────────

def main(enriched_path: Optional[pathlib.Path] = None) -> None:
    print("━━━ BDP × ORDS External Validation ━━━\n")

    if enriched_path is None:
        enriched_path = find_latest_enriched()
    print(f"BDP source  : {enriched_path.name}")
    print(f"ORDS source : {ORDS_CSV.name}\n")

    bdp  = load_bdp(enriched_path)
    ords = load_ords(ORDS_CSV)

    common = sorted(set(bdp) & set(ords))
    print(f"Brands in BDP (n≥{MIN_BDP_N})  : {len(bdp)}")
    print(f"Brands in ORDS (n≥{MIN_ORDS_N}) : {len(ords)}")
    print(f"Common brands                   : {len(common)}")
    print(f"  {', '.join(sorted(common))}\n")

    # ── Per-brand table ──────────────────────────────────────────────────────
    SEP = "─" * 100
    print("── Per-brand comparison ──")
    print(SEP)
    print(f"{'Brand':12s}  {'BDP_n':>5s}  {'S1':>7s}  {'S3':>7s}  {'ORDS_n':>6s}  "
          f"{'Fix%':>6s}  {'EoL%':>6s}  {'Repair%':>7s}  {'med_age':>7s}")
    print(SEP)
    for b in sorted(common, key=lambda x: -bdp[x].get("s1", 0)):
        bv = bdp[b]
        ov = ords[b]
        s1  = bv["s1"]
        s3  = bv["s3"]
        print(
            f"{b:12s}  {bv['n']:>5d}  {s1:>6.1%}  "
            f"{s3:>6.1%} " if not math.isnan(s3) else
            f"{b:12s}  {bv['n']:>5d}  {s1:>6.1%}  {'  —  ':>7s} ",
            end=""
        )
        print(
            f"  {ov['n']:>6d}  {ov['fix_rate']:>6.1%}  {ov['eol_rate']:>6.1%}  "
            f"{ov['repair_rate']:>7.1%}  {ov['med_age']:>7.1f}"
        )
    print(SEP)

    # ── Spearman correlations ────────────────────────────────────────────────
    metrics = [
        ("S1",        "ORDS_fix_rate",    [bdp[b]["s1"]            for b in common], [ords[b]["fix_rate"]    for b in common]),
        ("S1",        "ORDS_repair_rate", [bdp[b]["s1"]            for b in common], [ords[b]["repair_rate"] for b in common]),
        ("S1",        "ORDS_eol_inv",     [bdp[b]["s1"]            for b in common], [1 - ords[b]["eol_rate"] for b in common]),
        ("S1",        "ORDS_med_age",     [bdp[b]["s1"]            for b in common], [ords[b]["med_age"]     for b in common]),
    ]
    # S3 only for brands where we have age banding
    s3_brands = [b for b in common if not math.isnan(bdp[b]["s3"])]
    if len(s3_brands) >= 5:
        metrics += [
            ("S3", "ORDS_med_age", [bdp[b]["s3"] for b in s3_brands], [ords[b]["med_age"] for b in s3_brands]),
            ("S3", "ORDS_eol_inv", [bdp[b]["s3"] for b in s3_brands], [1 - ords[b]["eol_rate"] for b in s3_brands]),
        ]

    print("\n── Spearman correlations (bootstrap 95% CI, n_boot=5,000) ──")
    print(f"{'Signal':5s}  {'ORDS metric':18s}  {'n':>4s}  {'ρ':>6s}  {'95% CI':>18s}  {'interpretation':s}")
    print("─" * 85)
    for sig, metric, x, y in metrics:
        # Filter NaN pairs
        pairs = [(xi, yi) for xi, yi in zip(x, y) if not (math.isnan(xi) or math.isnan(yi))]
        if len(pairs) < 4:
            print(f"{sig:5s}  {metric:18s}  {'<4 valid pairs, skip':s}")
            continue
        px, py = zip(*pairs)
        r = spearman_r(list(px), list(py))
        lo, hi = bootstrap_ci(list(px), list(py))
        sig_flag = "✓ significant" if (lo > 0 or hi < 0) else "ns"
        interp = "positive → consistent" if r > 0.3 else ("negative → conflict" if r < -0.3 else "weak/mixed")
        print(f"{sig:5s}  {metric:18s}  {len(pairs):>4d}  {r:>+.3f}  [{lo:+.3f}, {hi:+.3f}]  {sig_flag}  {interp}")

    print("\n── Notes ──")
    print("ORDS covers repair café events (UK, NL, DE, AT dominant) — geography differs from CZ+DE harvest.")
    print("S1 = working / (working+broken) in secondhand listings.")
    print("S3 = pre-2021 vintage share of age-banded listings (EU energy-label proxy).")
    print("ORDS_eol_inv = 1 - end-of-life rate (higher = more often fixable).")
    print("ORDS_med_age = median product age (years) at repair event.")
    print("Bootstrap CIs are percentile-based (2.5th–97.5th); n_boot=5,000, seed=42.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--enriched", type=pathlib.Path, default=None)
    args = parser.parse_args()
    main(args.enriched)
