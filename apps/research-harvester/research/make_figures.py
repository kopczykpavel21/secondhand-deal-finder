"""
Paper figures — generated from the pooled enriched data + s2_fe.json + QualityDB.

Usage:  python3 research/make_figures.py --out-dir <dir>
Outputs: fig1_bdp_ranking.png, fig2_validation_scatter.png,
         fig3_endurance_mechanism.png, fig4_data_funnel.png
"""

import argparse
import json
import math
import pathlib
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ords_validation import spearman_r
from bdp_composite import compute_s1_s3, compute_bdp, load_enriched
from qualitydb_validation import (load_warentest_appliances, load_dtest_appliances,
                                  brand_agg_warentest, brand_agg_dtest)

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"
plt.rcParams.update({"font.family": "sans-serif", "font.size": 9,
                     "axes.spines.top": False, "axes.spines.right": False})

POS, NEG, GREY, ACC = "#2b7a4b", "#b3452e", "#8a8a8a", "#3465a4"


def load_signals():
    files = sorted((DATA_DIR / "enriched").glob("enriched_harvest_*.jsonl"), reverse=True)
    rows = load_enriched(files[0])
    full = compute_s1_s3(rows)
    s2_raw = json.loads((DATA_DIR / "s2_fe.json").read_text())
    s2 = {b: v["fe"] for b, v in s2_raw.items()}
    # Composite = z(S1) + z(S2), matching bdp_composite.main(); S3 is corroborating
    # only (sales-trend confound, §3.3.3) and excluded from the composite.
    bdp = compute_bdp(full, s2_raw)
    return full, s2, bdp


def fig1_ranking(full, s2, bdp, out):
    rows = [(b, bdp[b]["bdp"]) for b in bdp
            if not math.isnan(bdp[b]["bdp"]) and full.get(b, {}).get("n", 0) >= 100]
    rows.sort(key=lambda x: x[1])
    brands = [r[0] for r in rows]; vals = [r[1] for r in rows]
    fig, ax = plt.subplots(figsize=(6.5, 5.2))
    ax.barh(brands, vals, color=[POS if v >= 0 else NEG for v in vals], alpha=.85)
    ax.axvline(0, color="black", lw=.8)
    for y, v in enumerate(vals):
        ax.text(v + (.06 if v >= 0 else -.06), y, f"{v:+.2f}", va="center",
                ha="left" if v >= 0 else "right", fontsize=7.5, color="#333")
    ax.set_xlabel("BDP composite: z(S1) + z(S2)")
    ax.set_title("Brand Durability Proxy — composite ranking (pooled, n ≥ 100 listings)",
                 fontsize=10, loc="left")
    ax.set_xlim(min(vals) - .9, max(vals) + .9)
    fig.tight_layout(); fig.savefig(out / "fig1_bdp_ranking.png", dpi=200); plt.close(fig)


def _scatter(ax, xs, ys, labels, xlab, ylab, title):
    ax.scatter(xs, ys, s=28, color=ACC, zorder=3)
    for x, y, b in zip(xs, ys, labels):
        ax.annotate(b, (x, y), textcoords="offset points", xytext=(4, 3), fontsize=7)
    rho = spearman_r(xs, ys)
    ax.set_xlabel(xlab); ax.set_ylabel(ylab)
    ax.set_title(f"{title}\nSpearman ρ = {rho:+.2f}", fontsize=9.5, loc="left")


def fig2_validation(full, s2, out):
    wt = brand_agg_warentest(load_warentest_appliances())
    dt = brand_agg_dtest(load_dtest_appliances())
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(9.5, 4.2))
    # S3 vs WT overall (x inverted so right = better)
    pts = [(-(wt[b]["overall_mean"]), full[b]["s3"], b) for b in wt
           if b in full and not math.isnan(full[b].get("s3", float("nan")))
           and not math.isnan(wt[b].get("overall_mean", float("nan")))]
    _scatter(a1, [p[0] for p in pts], [p[1] for p in pts], [p[2] for p in pts],
             "Warentest overall grade (inverted: right = better)",
             "S3 — old-vintage share",
             "(a) Stock composition vs lab quality")
    # S2 vs dTest
    pts2 = [(dt[b]["overall_mean"], s2[b], b) for b in dt if b in s2]
    _scatter(a2, [p[0] for p in pts2], [p[1] for p in pts2], [p[2] for p in pts2],
             "dTest overall score (0–100)",
             "S2 — hedonic brand fixed effect (log points)",
             "(b) Price premium vs lab quality")
    a2.axhline(0, color=GREY, lw=.7, ls="--")
    fig.tight_layout(); fig.savefig(out / "fig2_validation_scatter.png", dpi=200); plt.close(fig)


def fig3_endurance(full, out):
    wt1 = brand_agg_warentest(load_warentest_appliances(), min_n=1)
    pts = [(wt1[b]["endurance_mean"], full[b]["s1"], b) for b in wt1
           if b in full and wt1[b].get("endurance_n", 0) >= 1
           and not math.isnan(wt1[b].get("endurance_mean", float("nan")))
           and not math.isnan(full[b].get("s1", float("nan")))]
    fig, ax = plt.subplots(figsize=(6.2, 4.4))
    ax.scatter([p[0] for p in pts], [p[1] for p in pts], s=30, color=ACC, zorder=3)
    for x, y, b in pts:
        ax.annotate(b, (x, y), textcoords="offset points", xytext=(5, 2), fontsize=7.5)
    ax.invert_xaxis()  # left = worse, right = best (grade 1.0)
    ax.set_xlabel("Warentest endurance grade (German school scale; right = best)")
    ax.set_ylabel("S1 — functional-survival ratio")
    rho = spearman_r([-p[0] for p in pts], [p[1] for p in pts])
    ax.set_title(f"Lab endurance does not map onto resale working share "
                 f"(ρ = {rho:+.2f}, n.s.)\n"
                 "Brands sharing the best grade (1.0) span nearly the full S1 range",
                 fontsize=9.5, loc="left")
    fig.tight_layout(); fig.savefig(out / "fig3_endurance_mechanism.png", dpi=200); plt.close(fig)


def fig4_funnel(out):
    stages = [("Harvested (2 waves, de-duplicated)", 13643),
              ("Relevant appliance listings", 8962),
              ("+ brand identified", 8490),
              ("+ price parsed  (S2 pool)", 7781),
              ("+ status stated", 4580),
              ("explicitly working / broken  (S1 pool)", 4288),
              ("+ vintage band  (S3 pool)", 1126)]
    fig, ax = plt.subplots(figsize=(6.5, 3.6))
    ys = range(len(stages) - 1, -1, -1)
    ax.barh(list(ys), [s[1] for s in stages], color=ACC, alpha=.8)
    for y, (label, n) in zip(ys, stages):
        ax.text(n + 150, y, f"{n:,}", va="center", fontsize=8.5)
        ax.text(-350, y, label, va="center", ha="right", fontsize=8.5)
    ax.set_yticks([]); ax.set_xlim(0, 16200)
    ax.set_xlabel("listings")
    ax.set_title("Data accounting: from raw harvest to analysis pools", fontsize=10, loc="left")
    fig.tight_layout(); fig.savefig(out / "fig4_data_funnel.png", dpi=200,
                                    bbox_inches="tight"); plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", type=pathlib.Path,
                    default=pathlib.Path(__file__).parent.parent / "figures")
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    full, s2, bdp = load_signals()
    fig1_ranking(full, s2, bdp, args.out_dir)
    fig2_validation(full, s2, args.out_dir)
    fig3_endurance(full, args.out_dir)
    fig4_funnel(args.out_dir)
    print(f"4 figures written → {args.out_dir}")


if __name__ == "__main__":
    main()
