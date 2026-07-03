"""
Second-annotator kit for inter-rater reliability (Cohen's kappa).

Two modes:

1. Generate an annotation sheet (default):
     python3 research/annotation_kit.py --n 200 --out data/annotation_sheet.csv
   Produces a stratified sample (source × category) with listing text and EMPTY
   `anno_brand` / `anno_status` columns for a human annotator to fill in.
   Status labels: working / degraded / broken / unknown.

2. Score a completed sheet against the automated classifier and the first
   (gold) annotation pass:
     python3 research/annotation_kit.py --score data/annotation_sheet_filled.csv
   Reports Cohen's kappa for brand and status, plus disagreement listings.
"""

import argparse
import csv
import pathlib
import random
import sys
from collections import Counter, defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from bdp_composite import load_enriched, find_latest_enriched


def stratified_sample(rows, n, seed=7):
    random.seed(seed)
    strata = defaultdict(list)
    for r in rows:
        strata[(r.get("source"), r.get("categoryId"))].append(r)
    total = sum(len(v) for v in strata.values())
    out = []
    for key, items in sorted(strata.items()):
        k = max(1, round(n * len(items) / total))
        out.extend(random.sample(items, min(k, len(items))))
    random.shuffle(out)
    return out[:n]


def generate(n, out_path):
    rows = load_enriched(find_latest_enriched())
    sample = stratified_sample([r for r in rows if r.get("isRelevant")], n)
    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "source", "category", "title", "description",
                    "parser_brand", "parser_status",
                    "anno_brand", "anno_status", "anno_notes"])
        for r in sample:
            w.writerow([r["id"], r.get("source"), r.get("categoryId"),
                        (r.get("title") or "")[:300],
                        (r.get("description") or "")[:600],
                        r.get("brandParsed") or "", r.get("functionalStatus") or "unknown",
                        "", "", ""])
    print(f"Annotation sheet ({len(sample)} listings) → {out_path}")
    print("Instructions for the second annotator:")
    print("  anno_brand : canonical brand name, or NONE if no brand identifiable")
    print("  anno_status: working | degraded | broken | unknown")
    print("  Judge ONLY from title+description text. Do not consult parser columns")
    print("  (hide columns F-G in your spreadsheet before annotating).")


def cohen_kappa(a, b):
    assert len(a) == len(b) and a
    labels = sorted(set(a) | set(b))
    n = len(a)
    po = sum(1 for x, y in zip(a, b) if x == y) / n
    pe = sum((a.count(l) / n) * (b.count(l) / n) for l in labels)
    return (po - pe) / (1 - pe) if pe < 1 else 1.0


def score(path):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    filled = [r for r in rows if (r.get("anno_status") or "").strip()]
    if not filled:
        print("No filled anno_status rows found — has the annotator completed the sheet?")
        return
    print(f"Scored rows: {len(filled)} / {len(rows)}")

    pb = [(r["parser_brand"] or "NONE").strip() for r in filled]
    ab = [(r["anno_brand"] or "NONE").strip() for r in filled]
    ps = [(r["parser_status"] or "unknown").strip() for r in filled]
    as_ = [(r["anno_status"] or "unknown").strip() for r in filled]

    print(f"\nCohen's κ (parser vs annotator):")
    print(f"  brand : {cohen_kappa(pb, ab):.3f}")
    print(f"  status: {cohen_kappa(ps, as_):.3f}")

    print(f"\nStatus confusion (parser rows × annotator cols):")
    labels = ["working", "degraded", "broken", "unknown"]
    conf = Counter(zip(ps, as_))
    print(f"{'':10s}" + "".join(f"{l:>10s}" for l in labels))
    for pl in labels:
        print(f"{pl:10s}" + "".join(f"{conf.get((pl, al), 0):>10d}" for al in labels))

    print("\nDisagreements (first 15):")
    k = 0
    for r in filled:
        if (r["parser_status"] or "unknown") != (r["anno_status"] or "unknown"):
            print(f"  [{r['id']}] parser={r['parser_status']} anno={r['anno_status']}: "
                  f"{r['title'][:70]}")
            k += 1
            if k >= 15:
                break


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--out", type=pathlib.Path,
                    default=pathlib.Path(__file__).parent.parent / "data" / "annotation_sheet.csv")
    ap.add_argument("--score", type=pathlib.Path, default=None)
    args = ap.parse_args()
    if args.score:
        score(args.score)
    else:
        generate(args.n, args.out)


if __name__ == "__main__":
    main()
