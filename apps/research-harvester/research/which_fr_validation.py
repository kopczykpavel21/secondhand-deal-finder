"""
Additional external validation — UK Which? test scores and the official French
repairability index (indice de réparabilité), both from QualityDB.

  which_reviews          : 1,092 appliance reviews with test_score_percent (0-100)
  fr_repairability_index : official note_ir (0-10) per model; appliance
                           categories: lave-vaisselle, lave-linge (hublot/top)

Usage: python3 research/which_fr_validation.py
"""

import json
import math
import pathlib
import sqlite3
import sys
from collections import defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ords_validation import spearman_r, bootstrap_ci
from bdp_composite import compute_s1_s3, load_enriched, find_latest_enriched
from qualitydb_validation import norm_brand, QUALITYDB_PATH

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"

WHICH_APPLIANCE_SLUGS = (
    "washing-machines", "washer-dryers", "tumble-dryers", "dishwashers",
    "fridge-freezers", "fridges", "freezers", "built-in-ovens",
)


def load_which_brand_means():
    con = sqlite3.connect(QUALITYDB_PATH)
    cur = con.cursor()
    q = ",".join("?" * len(WHICH_APPLIANCE_SLUGS))
    cur.execute(f"""SELECT product_name, test_score_percent FROM which_reviews
                    WHERE category_slug IN ({q}) AND test_score_percent IS NOT NULL""",
                list(WHICH_APPLIANCE_SLUGS))
    agg = defaultdict(list)
    for name, score in cur.fetchall():
        b = norm_brand(name.split()[0]) if name else None
        if b:
            agg[b].append(float(score))
    con.close()
    return {b: {"mean": sum(v) / len(v), "n": len(v)}
            for b, v in agg.items() if len(v) >= 3}


def load_fr_ir_brand_means():
    con = sqlite3.connect(QUALITYDB_PATH)
    cur = con.cursor()
    cur.execute("""SELECT nom_modele, nom_metteur_sur_le_marche, note_ir
                   FROM fr_repairability_index
                   WHERE categorie_produit LIKE 'Lave-%' AND note_ir IS NOT NULL""")
    agg = defaultdict(list)
    for model, metteur, ir in cur.fetchall():
        b = norm_brand((model or "").split()[0]) or norm_brand((metteur or "").split()[0])
        if b:
            agg[b].append(float(ir))
    con.close()
    return {b: {"mean": sum(v) / len(v), "n": len(v)}
            for b, v in agg.items() if len(v) >= 3}


def corr(label, ext, bdp_sig, n_min=5):
    pairs = [(b, bdp_sig[b], ext[b]["mean"]) for b in ext
             if b in bdp_sig and not math.isnan(bdp_sig[b])]
    if len(pairs) < n_min:
        print(f"  {label}: n={len(pairs)} — too few")
        return
    xs = [p[1] for p in pairs]; ys = [p[2] for p in pairs]
    rho = spearman_r(xs, ys); lo, hi = bootstrap_ci(xs, ys)
    sig = "✓ sig" if lo > 0 or hi < 0 else "n.s."
    print(f"  {label:38s} ρ={rho:+.3f}  [{lo:+.3f},{hi:+.3f}]  n={len(pairs)}  {sig}")
    return pairs


def main():
    enriched = find_latest_enriched()
    rows = load_enriched(enriched)
    full = compute_s1_s3(rows)
    s1 = {b: v["s1"] for b, v in full.items()}
    s3 = {b: v["s3"] for b, v in full.items()}
    s2 = {b: v["fe"] for b, v in
          json.loads((DATA_DIR / "s2_fe.json").read_text()).items()}

    which = load_which_brand_means()
    fr = load_fr_ir_brand_means()

    print(f"Enriched: {enriched.name}")
    print(f"\n━━━ Which? (UK) appliance test scores — brand means (≥3 tested) ━━━")
    for b, v in sorted(which.items(), key=lambda x: -x[1]["mean"]):
        print(f"  {b:12s}  {v['mean']:5.1f}  (n={v['n']})")

    print(f"\n━━━ BDP × Which? test score (0-100, higher=better) ━━━")
    corr("S1  × Which_score", which, s1)
    corr("S2  × Which_score", which, s2)
    corr("S3  × Which_score", which, s3)

    print(f"\n━━━ French repairability index (lave-linge + lave-vaisselle) ━━━")
    for b, v in sorted(fr.items(), key=lambda x: -x[1]["mean"]):
        print(f"  {b:12s}  note_ir={v['mean']:4.1f}/10  (n={v['n']})")

    print(f"\n━━━ BDP × French repairability index ━━━")
    print("(repairability is the ORTHOGONAL dimension — nulls expected, cf. ORDS)")
    corr("S1  × FR_repairability", fr, s1)
    corr("S2  × FR_repairability", fr, s2)
    corr("S3  × FR_repairability", fr, s3)


if __name__ == "__main__":
    main()
