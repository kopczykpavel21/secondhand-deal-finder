"""
Deep validation: BDP signals vs. Warentest / dTest lab-test scores.

Sources (from QualityDB at /Users/Pavel/Downloads/qualitydb/QualityDB/products.db):
  - Warentest (DE): 3,307 lab-tested products across categories.
    Key sub-ratings: overall, endurance, wash, handling, environmental.
    ENDURANCE is the direct lab durability measure — most valuable for BDP validation.
  - dTest (CZ): 9,073 tested products.
    Key score: overall_score (0–100), plus per-dimension scores (praní, hlučnost, etc.)

Filtering logic:
  APPLIANCE subgroups (keep):
    dTest: Pračky*, Sušičky prádla*, Myčky [year], Kombinované chladničky*,
           Chladničky kombinované*, Mrazáky, Vestavné trouby*, Sporáky*
    Warentest: Washing Machines, Tumble Dryers, Dishwashers, Refrigerators,
               Fridge-Freezers, Freezers, Washer Dryers, Built-in Ovens,
               Freestanding Cookers, Range Cookers

  SPARE PARTS / CONSUMABLES / NON-APPLIANCES (drop):
    dTest: laundry detergents (Prací*), stain removers (Odstraňovač*),
           ironing boards (Žehlicí prkna), irons (Žehličky), clotheshorses,
           dishwasher tablets (Tablety*, Multifunkční tablety*),
           dishwasher detergents (Prostředky na mytí*, Prášky a gely do myčky*),
           cooling boxes (Chladicí boxy*), steam stations (Parní stanice*)

Usage:
  python research/qualitydb_validation.py
  python research/qualitydb_validation.py --bdp-s2 data/s2_fe.json
"""

import json
import math
import pathlib
import re
import sqlite3
import argparse
from collections import defaultdict
from typing import Optional

import sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ords_validation import spearman_r, bootstrap_ci
from bdp_composite import compute_s1_s3, load_enriched

QUALITYDB_PATH = pathlib.Path("/Users/Pavel/Downloads/qualitydb/QualityDB/products.db")
DATA_DIR = pathlib.Path(__file__).parent.parent / "data"

# ── BDP study categories mapped to Warentest categories ─────────────────────
WT_APPLIANCE_CATEGORIES = {
    "Washing Machines", "Tumble Dryers", "Dishwashers",
    "Refrigerators", "Fridge-Freezers", "Freezers", "Washer Dryers",
    "Built-in Ovens", "Freestanding Cookers", "Range Cookers",
    "Hobs",   # borderline — include for coverage
}

# Maps Warentest category → our BDP category
WT_TO_BDP_CAT = {
    "Washing Machines": "washing_machine",
    "Washer Dryers":    "washing_machine",
    "Tumble Dryers":    "dryer",
    "Dishwashers":      "dishwasher",
    "Refrigerators":    "fridge",
    "Fridge-Freezers":  "fridge",
    "Freezers":         "fridge",
    "Built-in Ovens":   "oven",
    "Freestanding Cookers": "oven",
    "Range Cookers":    "oven",
}

# dTest subgroup prefixes that are actual appliances (not detergents/accessories)
DTEST_APPLIANCE_SUBGROUP_PREFIXES = (
    "Pračky",          # washing machines (all years, top-loading, washer-dryers)
    "Sušičky prádla",  # tumble dryers
    "Myčky 20",        # dishwashers with year (excludes tablets/detergents)
    "Myčky od",
    "Kombinované chladničky",
    "Chladničky kombinované",
    "Chladničky 20",
    "Chladničky starší",
    "Mrazáky",
    "Vestavné trouby",
    "Pyrolytické trouby",
    "Sporáky",
)

DTEST_TO_BDP_CAT = {
    "Pračky": "washing_machine",
    "Sušičky prádla": "dryer",
    "Myčky": "dishwasher",
    "Kombinované chladničky": "fridge",
    "Chladničky kombinované": "fridge",
    "Chladničky": "fridge",
    "Mrazáky": "fridge",
    "Vestavné trouby": "oven",
    "Pyrolytické trouby": "oven",
    "Sporáky": "oven",
}

# Known BDP brand names for normalization
BRAND_NORM = {
    "aeg": "AEG", "bosch": "Bosch", "siemens": "Siemens", "miele": "Miele",
    "electrolux": "Electrolux", "whirlpool": "Whirlpool", "samsung": "Samsung",
    "lg": "LG", "gorenje": "Gorenje", "beko": "Beko", "indesit": "Indesit",
    "zanussi": "Zanussi", "candy": "Candy", "hoover": "Hoover",
    "bauknecht": "Bauknecht", "privileg": "Privileg", "haier": "Haier",
    "hisense": "Hisense", "sharp": "Sharp", "liebherr": "Liebherr",
    "mora": "Mora", "philco": "Philco", "neff": "Neff", "constructa": "Constructa",
    "hotpoint": "Hotpoint", "ariston": "Ariston", "grundig": "Grundig",
    "amica": "Amica", "smeg": "Smeg", "blomberg": "Blomberg",
    "panasonic": "Panasonic", "toshiba": "Toshiba", "vestel": "Vestel",
    "brandt": "Brandt", "fagor": "Fagor", "bsh": "Bosch",
}

# Warentest-specific: model-number prefixes → brand
# Used when `brand` column contains a model number (no spaces, upper+digits)
_WT_MODEL_PREFIX: list[tuple[str, str]] = [
    # Bosch WGB/WGG/WUU/WAN/WAX/WAT/WLK prefixes
    ("WGB", "Bosch"), ("WGG", "Bosch"), ("WUU", "Bosch"), ("WAN", "Bosch"),
    ("WAX", "Bosch"), ("WAT", "Bosch"), ("WLK", "Bosch"),
    # Siemens WG44/WU14/WM14/WG34/WG56 prefixes
    ("WG4", "Siemens"), ("WG3", "Siemens"), ("WG5", "Siemens"),
    ("WU1", "Siemens"), ("WM1", "Siemens"), ("WM6", "Siemens"),
    # AEG: LW, LR, LTR, LTH, LFE, LSR, WPNA prefixes
    ("LWR", "AEG"), ("LW8", "AEG"), ("LW7", "AEG"), ("LW6", "AEG"),
    ("LR6", "AEG"), ("LR7", "AEG"), ("LR8", "AEG"),
    ("LTR", "AEG"), ("LTH", "AEG"), ("LFE", "AEG"), ("LSR", "AEG"),
    ("WPNA", "AEG"), ("WPN", "AEG"),
    # Samsung WW prefix
    ("WW", "Samsung"),
    # LG F4W, F6W, F2V
    ("F4W", "LG"), ("F6W", "LG"), ("F2V", "LG"), ("F4DV", "LG"),
    # Liebherr L6F, L7F, L5D
    ("L6F", "Liebherr"), ("L7F", "Liebherr"), ("L5D", "Liebherr"),
    # Haier HW, HWD
    ("HW8", "Haier"), ("HW1", "Haier"), ("HWD", "Haier"),
    # Miele WWE, WWF, WCE, WDB, WCR
    ("WWE", "Miele"), ("WWF", "Miele"), ("WCE", "Miele"),
    ("WDB", "Miele"), ("WCR", "Miele"), ("WCI", "Miele"),
    # Bauknecht BW, B7W, B8W, AW, WMT, B6R
    ("BW ", "Bauknecht"), ("B7W", "Bauknecht"), ("B8W", "Bauknecht"),
    ("AW ", "Bauknecht"), ("WMT", "Bauknecht"), ("B6R", "Bauknecht"),
    # Beko WML, B5W, WC5, B4W, B3W
    ("WML", "Beko"), ("B5W", "Beko"), ("WC5", "Beko"),
    ("B4W", "Beko"), ("B3W", "Beko"),
    # Privileg PWT
    ("PWT", "Privileg"),
    # Sharp ES-
    ("ES-", "Sharp"),
    # Amica WA (with space or digit after)
    ("WA ", "Amica"), ("WA4", "Amica"), ("WA5", "Amica"),
]


def norm_brand(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    cleaned = raw.strip()

    # Extract first token of "Brand Podrobný článek..." (dTest)
    cleaned = re.split(r'\s+Podrobný', cleaned)[0].strip()
    cleaned = re.split(r'\s+Test\b', cleaned)[0].strip()

    # Try canonical lookup first (handles normal brand names like "Bosch", "AEG", ...)
    lower = cleaned.lower()
    for key, canon in BRAND_NORM.items():
        if key in lower.split() or lower.startswith(key):
            return canon

    # If it looks like a model number (all caps + digits + separators, no spaces),
    # try the prefix→brand table before giving up.
    if re.match(r'^[A-Z0-9\-_\./]{4,}$', cleaned):
        for prefix, brand in _WT_MODEL_PREFIX:
            if cleaned.startswith(prefix):
                return brand
        return None  # unresolved model number

    # Short single-word brand, first letter uppercase AND contains lowercase → keep as-is
    # Pure uppercase short strings (e.g. WMT, KR, G, TWC) are likely model codes, not brands
    if len(cleaned) <= 15 and cleaned[0].isupper() and any(c.islower() for c in cleaned):
        return cleaned
    return None


# ── Loaders ──────────────────────────────────────────────────────────────────

def load_warentest_appliances() -> list[dict]:
    con = sqlite3.connect(QUALITYDB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    cur.execute("""
        SELECT p.Name, p.brand, p.Category, p.Price_EUR, p.cat_rank, p.cat_total,
               p.details_json, p.ProductURL
        FROM products p
        WHERE p.source = 'warentest'
          AND p.Category IN ({})
    """.format(",".join("?" * len(WT_APPLIANCE_CATEGORIES))),
    list(WT_APPLIANCE_CATEGORIES))

    rows = []
    for r in cur.fetchall():
        d = json.loads(r["details_json"]) if r["details_json"] else {}
        subs = d.get("sub_ratings", {})

        # Extract brand from name if missing
        brand_raw = r["brand"] or (r["Name"].split()[0] if r["Name"] else None)
        brand = norm_brand(brand_raw)
        # Second try: first word of product name
        if not brand and r["Name"]:
            brand = norm_brand(r["Name"].split()[0])

        def get_grade(key):
            v = subs.get(key, {})
            g = v.get("grade")
            return float(g) if g is not None else None

        rows.append({
            "name":        r["Name"],
            "brand":       brand,
            "wt_category": r["Category"],
            "bdp_cat":     WT_TO_BDP_CAT.get(r["Category"], "other"),
            "price_eur":   r["Price_EUR"],
            "cat_rank":    r["cat_rank"],
            "cat_total":   r["cat_total"],
            "overall":     get_grade("overall"),
            "endurance":   get_grade("endurance"),
            "wash":        get_grade("wash") or get_grade("cleaning") or get_grade("cooling"),
            "handling":    get_grade("handling") or get_grade("ease_of_use"),
            "environmental": get_grade("environmental") or get_grade("energy_efficiency"),
            "safety":      get_grade("safety"),
            "url":         r["ProductURL"],
        })
    con.close()
    return rows


def load_dtest_appliances() -> list[dict]:
    con = sqlite3.connect(QUALITYDB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    cur.execute("""
        SELECT Name, brand, Category, Price_CZK, Price_EUR, cat_rank, cat_total,
               details_json, ProductURL
        FROM products WHERE source = 'dtest'
    """)

    rows = []
    for r in cur.fetchall():
        d = json.loads(r["details_json"]) if r["details_json"] else {}
        subgroup = d.get("subgroup", "")

        # Filter: only actual appliances
        if not any(subgroup.startswith(pfx) for pfx in DTEST_APPLIANCE_SUBGROUP_PREFIXES):
            continue

        brand_raw = d.get("brand") or r["brand"]
        brand = norm_brand(brand_raw)
        if not brand and r["Name"]:
            brand = norm_brand(r["Name"].split()[0])

        # Map subgroup to BDP category
        bdp_cat = "other"
        for prefix, cat in DTEST_TO_BDP_CAT.items():
            if subgroup.startswith(prefix):
                bdp_cat = cat
                break

        # Extract scores
        scores = d.get("scores", {})
        def gscore(key):
            return scores.get(key, {}).get("score") if scores else None

        rows.append({
            "name":         r["Name"],
            "brand":        brand,
            "subgroup":     subgroup,
            "bdp_cat":      bdp_cat,
            "price_czk":    r["Price_CZK"],
            "price_eur":    r["Price_EUR"],
            "cat_rank":     r["cat_rank"],
            "cat_total":    r["cat_total"],
            "overall_score": d.get("overall_score"),
            "overall_grade": d.get("overall_grade"),
            # Czech score keys
            "wash_score":   gscore("praní") or gscore("mytí"),
            "rinse_score":  gscore("máchání"),
            "spin_score":   gscore("odstřeďování"),
            "energy_score": gscore("spotřeba elektrické energie"),
            "water_score":  gscore("spotřeba vody"),
            "noise_score":  gscore("hlučnost"),
            "handling_score": gscore("obsluha"),
        })
    con.close()
    return rows


# ── Brand aggregation ─────────────────────────────────────────────────────────

def brand_agg_warentest(rows: list[dict], cat_filter: Optional[str] = None,
                        min_n: int = 2) -> dict:
    """Per-brand averages of WT grades (lower = better in Warentest 1–6 scale)."""
    agg = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if not r["brand"]:
            continue
        if cat_filter and r["bdp_cat"] != cat_filter:
            continue
        b = r["brand"]
        for key in ["overall", "endurance", "wash", "handling", "environmental", "safety"]:
            v = r[key]
            if v is not None:
                agg[b][key].append(v)
        agg[b]["n"].append(1)

    result = {}
    for b, vals in agg.items():
        n = len(vals["n"])
        if n < min_n:
            continue
        row = {"n": n}
        for key in ["overall", "endurance", "wash", "handling", "environmental", "safety"]:
            vs = vals[key]
            row[f"{key}_mean"] = sum(vs) / len(vs) if vs else float("nan")
            row[f"{key}_n"] = len(vs)
        result[b] = row
    return result


def brand_agg_dtest(rows: list[dict], cat_filter: Optional[str] = None) -> dict:
    """Per-brand averages of dTest overall_score (0–100, higher = better)."""
    agg = defaultdict(list)
    for r in rows:
        if not r["brand"]:
            continue
        if cat_filter and r["bdp_cat"] != cat_filter:
            continue
        if r["overall_score"] is None:
            continue
        agg[r["brand"]].append({
            "overall": r["overall_score"],
            "wash":    r["wash_score"],
            "energy":  r["energy_score"],
            "noise":   r["noise_score"],
            "handling": r["handling_score"],
        })

    result = {}
    for b, items in agg.items():
        if len(items) < 2:
            continue
        result[b] = {
            "n": len(items),
            "overall_mean": sum(x["overall"] for x in items) / len(items),
            "wash_mean":    sum(x["wash"] for x in items if x["wash"]) / max(1, sum(1 for x in items if x["wash"])),
        }
    return result


# ── Correlation helpers ───────────────────────────────────────────────────────

def _nan(v): return v is None or (isinstance(v, float) and math.isnan(v))

def correlate_and_print(label: str, x_vals: list[float], y_vals: list[float],
                        x_brands: list[str], x_label: str, y_label: str):
    n = len(x_vals)
    if n < 4:
        print(f"  {label}: n={n} — too few for meaningful correlation")
        return
    rho = spearman_r(x_vals, y_vals)
    lo, hi = bootstrap_ci(x_vals, y_vals)
    sig = "✓ sig" if lo > 0 or hi < 0 else "n.s."
    print(f"  {label:50s}  ρ={rho:+.3f}  [{lo:+.3f}, {hi:+.3f}]  n={n}  {sig}")


# ── Main analysis ─────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--enriched", type=pathlib.Path, default=None)
    parser.add_argument("--bdp-s2",  type=pathlib.Path, default=None)
    args = parser.parse_args()

    enriched_path = args.enriched
    if enriched_path is None:
        d = DATA_DIR / "enriched"
        files = sorted(d.glob("enriched_harvest_*.jsonl"), reverse=True)
        if not files:
            raise FileNotFoundError("No enriched JSONL found.")
        enriched_path = files[0]

    s2_path = args.bdp_s2 or (DATA_DIR / "s2_fe.json")
    s2_fe: dict = {}
    if s2_path.exists():
        s2_fe = {b: v["fe"] for b, v in json.loads(s2_path.read_text()).items()}

    print(f"Enriched source : {enriched_path.name}")
    print(f"QualityDB       : {QUALITYDB_PATH}")

    # ── Load BDP signals ──────────────────────────────────────────────────────
    bdp_rows = load_enriched(enriched_path)
    bdp_full = compute_s1_s3(bdp_rows)

    # ── Load & filter external data ───────────────────────────────────────────
    wt_rows = load_warentest_appliances()
    dt_rows = load_dtest_appliances()

    print(f"\nWarentest appliances loaded : {len(wt_rows)} products")
    print(f"dTest     appliances loaded : {len(dt_rows)} products")

    # ── Warentest overview ────────────────────────────────────────────────────
    print("\n━━━ Warentest appliance overview ━━━")
    from collections import Counter
    cat_counts = Counter(r["wt_category"] for r in wt_rows)
    brand_counts = Counter(r["brand"] for r in wt_rows if r["brand"])
    endurance_count = sum(1 for r in wt_rows if r["endurance"] is not None)
    print(f"  Products by category:")
    for cat, n in sorted(cat_counts.items(), key=lambda x: -x[1]):
        e_n = sum(1 for r in wt_rows if r["wt_category"]==cat and r["endurance"] is not None)
        print(f"    {cat:30s}  n={n:4d}  endurance_rated={e_n}")
    print(f"\n  Products with endurance rating: {endurance_count}/{len(wt_rows)}")
    print(f"  Brands with ≥2 tested products: {sum(1 for b,c in brand_counts.items() if c>=2)}")

    # ── dTest overview ────────────────────────────────────────────────────────
    print("\n━━━ dTest appliance overview ━━━")
    cat_counts_dt = Counter(r["bdp_cat"] for r in dt_rows)
    brand_counts_dt = Counter(r["brand"] for r in dt_rows if r["brand"])
    sg_counts_dt = Counter(r["subgroup"] for r in dt_rows)
    print(f"  Products by BDP category: {dict(cat_counts_dt)}")
    print(f"  Products by subgroup:")
    for sg, n in sorted(sg_counts_dt.items(), key=lambda x: -x[1])[:20]:
        print(f"    {sg:50s}  n={n}")
    print(f"\n  Brands with ≥2 tested products: {sum(1 for b,c in brand_counts_dt.items() if c>=2)}")

    # ── Spare parts / consumables report ────────────────────────────────────
    all_dt = sqlite3.connect(QUALITYDB_PATH)
    cur = all_dt.cursor()
    cur.execute("SELECT COUNT(*) FROM products WHERE source='dtest'")
    total_dtest = cur.fetchone()[0]
    cur.execute("""
        SELECT json_extract(details_json,'$.subgroup') as sg, COUNT(*) as n
        FROM products WHERE source='dtest'
        AND NOT (
          json_extract(details_json,'$.subgroup') LIKE 'Pračky%'
          OR json_extract(details_json,'$.subgroup') LIKE 'Sušičky prádla%'
          OR json_extract(details_json,'$.subgroup') LIKE 'Myčky 20%'
          OR json_extract(details_json,'$.subgroup') LIKE 'Myčky od%'
          OR json_extract(details_json,'$.subgroup') LIKE 'Kombinované chladničky%'
          OR json_extract(details_json,'$.subgroup') LIKE 'Chladničky kombinované%'
          OR json_extract(details_json,'$.subgroup') LIKE 'Chladničky 20%'
          OR json_extract(details_json,'$.subgroup') LIKE 'Chladničky starší%'
          OR json_extract(details_json,'$.subgroup') LIKE 'Mrazáky%'
          OR json_extract(details_json,'$.subgroup') LIKE 'Vestavné trouby%'
          OR json_extract(details_json,'$.subgroup') LIKE 'Pyrolytické trouby%'
          OR json_extract(details_json,'$.subgroup') LIKE 'Sporáky%'
        )
        AND Category IN ('Pračky a péče o prádlo','Myčky nádobí','Chladničky a mrazničky','Vaření a pečení')
        GROUP BY sg ORDER BY n DESC LIMIT 20
    """)
    print(f"\n━━━ Filtered out (appliance categories, non-appliance subgroups) ━━━")
    print(f"  Total dTest: {total_dtest} | Appliances extracted: {len(dt_rows)} | Other: {total_dtest - len(dt_rows)}")
    print(f"  Top non-appliance subgroups in appliance categories (filtered out):")
    for sg, n in cur.fetchall():
        print(f"    {str(sg):50s}  n={n}")
    all_dt.close()

    # ── Brand-level aggregation ───────────────────────────────────────────────
    wt_brands = brand_agg_warentest(wt_rows)
    dt_brands = brand_agg_dtest(dt_rows)

    # ── Warentest brand table ─────────────────────────────────────────────────
    print("\n━━━ Warentest brand averages (all appliance categories pooled) ━━━")
    print(f"{'Brand':14s}  {'n':>4s}  {'Overall':>8s}  {'Endurance':>10s}  "
          f"{'Wash':>6s}  {'Handling':>9s}  {'Environ':>8s}")
    print("─" * 68)
    for b, v in sorted(wt_brands.items(), key=lambda x: x[1].get("endurance_mean", 9)):
        def fmt(key):
            m = v.get(f"{key}_mean", float("nan"))
            n = v.get(f"{key}_n", 0)
            return f"{m:.2f}({n})" if not math.isnan(m) else "    —   "
        e = v.get("endurance_mean", float("nan"))
        o = v.get("overall_mean", float("nan"))
        print(f"{b:14s}  {v['n']:>4d}  "
              f"{o:>8.2f}  {e:>10.2f}  "
              f"{fmt('wash'):>8s}  {fmt('handling'):>10s}  {fmt('environmental'):>10s}")

    # ── dTest brand table ─────────────────────────────────────────────────────
    print("\n━━━ dTest brand averages (appliances only, 0–100 higher=better) ━━━")
    print(f"{'Brand':14s}  {'n':>4s}  {'Overall':>8s}  {'Wash':>8s}")
    print("─" * 38)
    for b, v in sorted(dt_brands.items(), key=lambda x: -x[1]["overall_mean"]):
        w = v.get("wash_mean", float("nan"))
        print(f"{b:14s}  {v['n']:>4d}  {v['overall_mean']:>8.1f}  "
              f"{w:>8.1f}" if not math.isnan(w) else f"{b:14s}  {v['n']:>4d}  {v['overall_mean']:>8.1f}      —")

    # ── BDP × Warentest correlations ──────────────────────────────────────────
    print("\n━━━ BDP × Warentest Spearman correlations ━━━")
    print("(Warentest grades: lower = better; signs flipped for interpretability)")
    print()

    def make_paired(bdp_signal: dict, wt_signal_key: str, min_wt_n: int = 2):
        """Return (bdp_vals, wt_vals, brands) for brands present in both."""
        pairs = []
        for b, wt_v in wt_brands.items():
            wt_val = wt_v.get(f"{wt_signal_key}_mean", float("nan"))
            if _nan(wt_val) or wt_v.get(f"{wt_signal_key}_n", 0) < min_wt_n:
                continue
            bdp_val = bdp_signal.get(b)
            if bdp_val is None or _nan(bdp_val):
                continue
            pairs.append((b, bdp_val, wt_val))
        brands = [p[0] for p in pairs]
        bdp_v  = [p[1] for p in pairs]
        wt_v   = [-p[2] for p in pairs]  # negate: WT lower=better → higher=better
        return bdp_v, wt_v, brands

    s1_dict = {b: v["s1"] for b, v in bdp_full.items() if not _nan(v.get("s1"))}
    s3_dict = {b: v["s3"] for b, v in bdp_full.items() if not _nan(v.get("s3"))}
    s2_clean = {b: fe for b, fe in s2_fe.items() if not _nan(fe)}

    # ── Key analysis: endurance with ALL brands having ≥1 endurance rating ─────
    wt_brands_n1 = brand_agg_warentest(wt_rows, min_n=1)
    print("\n━━━ Warentest endurance × S1 — full brand table (n≥1 endurance product) ━━━")
    print(f"{'Brand':12s}  {'S1':>8s}  {'WT_endur_avg':>13s}  {'n_endur':>8s}  {'note':s}")
    print("─" * 65)
    endurance_pairs_all: list[tuple[str, float, float]] = []
    for b, wv in sorted(wt_brands_n1.items(), key=lambda x: x[1].get("endurance_mean", 9)):
        e = wv.get("endurance_mean", float("nan"))
        en = wv.get("endurance_n", 0)
        if _nan(e) or en == 0:
            continue
        s1 = s1_dict.get(b)
        s1_str = f"{s1:.3f}" if s1 is not None else "   —  "
        note = ""
        if b == "Miele":
            note = "kept avg 16-18yr → few reach resale while working"
        elif b in ("LG", "Samsung", "Privileg"):
            note = "lab-excellent → high S1 unexpected"
        elif b == "AEG":
            note = "repair uneconomical → broken units discarded not listed"
        mark = "***" if en >= 3 else ("**" if en == 2 else "  ")
        print(f"{b:12s}  {s1_str:>8s}  {e:>13.2f}{mark}  {en:>8d}  {note}")
        if s1 is not None:
            endurance_pairs_all.append((b, s1, e))

    if len(endurance_pairs_all) >= 4:
        bnames = [p[0] for p in endurance_pairs_all]
        s1v = [p[1] for p in endurance_pairs_all]
        # negate WT grade: lower=better → higher=better, consistent with S1
        endv_inv = [-p[2] for p in endurance_pairs_all]
        rho = spearman_r(s1v, endv_inv)
        lo, hi = bootstrap_ci(s1v, endv_inv)
        sig = "✓ sig" if lo > 0 else "n.s."
        print(f"\n  ρ(S1, WT_endurance_inv) = {rho:+.3f}  95% CI [{lo:+.3f}, {hi:+.3f}]"
              f"  n={len(endurance_pairs_all)}  {sig}")
        print(f"  (includes single-product brands; n≥1 endurance rating)")
        print(f"  Note: Miele/LG/Samsung/Privileg all have WT_endurance=1.0 (best) but moderate S1,")
        print(f"  consistent with survivor-selection hypothesis (machines kept long, few reach resale).")

    for wt_key in ["endurance", "overall", "wash", "handling", "environmental"]:
        print(f"  ── vs. Warentest_{wt_key} ──")
        for bdp_label, bdp_sig in [("S1", s1_dict), ("S2_FE", s2_clean), ("S3", s3_dict)]:
            bdp_v, wt_v, brands = make_paired(bdp_sig, wt_key)
            if len(brands) < 4:
                continue
            rho = spearman_r(bdp_v, wt_v)
            lo, hi = bootstrap_ci(bdp_v, wt_v)
            sig = "✓ sig" if lo > 0 else "n.s."
            print(f"    BDP_{bdp_label:6s} × WT_{wt_key:12s}  ρ={rho:+.3f}  [{lo:+.3f},{hi:+.3f}]  n={len(brands)}  {sig}")
            if wt_key == "endurance" and len(brands) >= 4:
                # Print the comparison table for endurance (most important)
                pairs_sorted = sorted(zip(brands, bdp_v, wt_v), key=lambda x: -x[2])
                if bdp_label == "S1":
                    print(f"    {'Brand':14s}  {'S1':>8s}  {'WT_endurance':>13s}(inv)")
                    for b, bv, wv in pairs_sorted:
                        print(f"    {b:14s}  {bv:>8.3f}  {wv:>13.3f}")
                    print()

    # ── dTest × BDP correlations ───────────────────────────────────────────────
    print("\n━━━ BDP × dTest Spearman correlations ━━━")
    print("(dTest scores: higher = better)")
    print()

    def make_paired_dt(bdp_signal: dict, min_dt_n: int = 2):
        pairs = []
        for b, dt_v in dt_brands.items():
            if dt_v.get("n", 0) < min_dt_n:
                continue
            bdp_val = bdp_signal.get(b)
            if bdp_val is None or _nan(bdp_val):
                continue
            pairs.append((b, bdp_val, dt_v["overall_mean"]))
        return [p[1] for p in pairs], [p[2] for p in pairs], [p[0] for p in pairs]

    for bdp_label, bdp_sig in [("S1", s1_dict), ("S2_FE", s2_clean), ("S3", s3_dict)]:
        bdp_v, dt_v, brands = make_paired_dt(bdp_sig)
        if len(brands) < 4:
            print(f"  BDP_{bdp_label} × dTest_overall: n={len(brands)} — too few")
            continue
        rho = spearman_r(bdp_v, dt_v)
        lo, hi = bootstrap_ci(bdp_v, dt_v)
        sig = "✓ sig" if lo > 0 else "n.s."
        print(f"  BDP_{bdp_label:6s} × dTest_overall  ρ={rho:+.3f}  [{lo:+.3f},{hi:+.3f}]  n={len(brands)}  {sig}")
        if bdp_label == "S1":
            print(f"  {'Brand':14s}  {'S1':>8s}  {'dTest_overall':>14s}")
            for b, bv, dv in sorted(zip(brands, bdp_v, dt_v), key=lambda x: -x[2]):
                print(f"  {b:14s}  {bv:>8.3f}  {dv:>14.1f}")
            print()

    # ── Summary table: all signals side-by-side for common brands ─────────────
    print("\n━━━ Full cross-validation table (brands in ≥2 datasets) ━━━")
    all_brands = set(s1_dict) | set(s2_clean) | set(dt_brands) | set(wt_brands)
    header = (f"{'Brand':14s}  {'S1':>7s}  {'S2_FE':>7s}  {'S3':>7s}  "
              f"{'WT_endur':>9s}  {'WT_overall':>10s}  {'dTest':>7s}  {'n_sources':>9s}")
    print(header)
    print("─" * len(header))
    for b in sorted(all_brands):
        s1 = s1_dict.get(b, float("nan"))
        s2 = s2_clean.get(b, float("nan"))
        s3 = s3_dict.get(b, {}).get("s3", float("nan")) if isinstance(s3_dict.get(b), dict) else s3_dict.get(b, float("nan"))
        wt = wt_brands.get(b, {})
        dt = dt_brands.get(b, {})
        wt_e = wt.get("endurance_mean", float("nan"))
        wt_o = wt.get("overall_mean", float("nan"))
        dt_o = dt.get("overall_mean", float("nan"))
        n_src = sum([not _nan(s1), not _nan(s2), not _nan(wt_e), not _nan(dt_o)])
        if n_src < 2:
            continue
        def f(v, fmt=".3f"): return f"{v:{fmt}}" if not _nan(v) else "   —   "
        # S3 is in bdp_full
        s3v = bdp_full.get(b, {}).get("s3", float("nan"))
        print(f"{b:14s}  {f(s1):>7s}  {f(s2):>7s}  {f(s3v):>7s}  "
              f"{f(wt_e):>9s}  {f(wt_o):>10s}  {f(dt_o,'.1f'):>7s}  {n_src:>9d}")


if __name__ == "__main__":
    main()
