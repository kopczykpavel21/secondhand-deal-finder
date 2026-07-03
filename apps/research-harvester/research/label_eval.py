"""
Validation labeling for brand-parser and condition-classifier.

Samples N listings from the enriched JSONL, applies a "gold-standard"
labeling pass (careful regex over raw title + description), then computes
precision, recall, and F1 against the parser output.

Gold-standard rules
  Brand : longest-match scan of title first, then description, against an
          expanded brand dictionary.  Returns None if no brand found.
  Status: keyword scan of title + description using explicit CZ+DE terms,
          coarser than the parser but more transparent (good for validation).

Usage:
  python research/label_eval.py                        # random seed 42
  python research/label_eval.py --n 500 --seed 7
  python research/label_eval.py --export discrepancies.csv
"""

import argparse
import csv
import json
import math
import pathlib
import random
import re
from collections import defaultdict
from typing import Optional

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"
CATEGORIES = ["washing_machine", "dishwasher", "fridge", "oven", "dryer"]
SOURCES = ["bazos", "aukro", "kleinanzeigen", "shpock"]


# ── Gold-standard brand dictionary (superset of parser) ─────────────────────

# Order: longest first so "AEG-Electrolux" hits before "Electrolux"
GOLD_BRANDS: list[tuple[str, str]] = sorted([
    # (pattern_lower, canonical)
    ("miele", "Miele"),
    ("bosch", "Bosch"),
    ("siemens", "Siemens"),
    ("aeg", "AEG"),
    ("electrolux", "Electrolux"),
    ("whirlpool", "Whirlpool"),
    ("samsung", "Samsung"),
    ("lg", "LG"),
    ("gorenje", "Gorenje"),
    ("beko", "Beko"),
    ("indesit", "Indesit"),
    ("zanussi", "Zanussi"),
    ("candy", "Candy"),
    ("hoover", "Hoover"),
    ("bauknecht", "Bauknecht"),
    ("privileg", "Privileg"),
    ("haier", "Haier"),
    ("hisense", "Hisense"),
    ("sharp", "Sharp"),
    ("liebherr", "Liebherr"),
    ("mora", "Mora"),
    ("philco", "Philco"),
    ("ignis", "Ignis"),
    ("ariston", "Ariston"),
    ("hotpoint", "Hotpoint"),
    ("constructa", "Constructa"),
    ("neff", "Neff"),
    ("gaggenau", "Gaggenau"),
    ("grundig", "Grundig"),
    ("vestel", "Vestel"),
    ("respekta", "Respekta"),
    ("concept", "Concept"),
    ("brandt", "Brandt"),
    ("fagor", "Fagor"),
    ("smeg", "Smeg"),
    ("blomberg", "Blomberg"),
    ("teka", "Teka"),
    ("liebherr", "Liebherr"),
    ("küppersbusch", "Küppersbusch"),
], key=lambda t: -len(t[0]))

def _brand_re(pattern: str) -> re.Pattern:
    return re.compile(
        r"(?<![a-z0-9])" + re.escape(pattern) + r"(?![a-z0-9])",
        re.IGNORECASE,
    )

GOLD_BRAND_PATTERNS = [(p, canon, _brand_re(p)) for p, canon in GOLD_BRANDS]


def gold_brand(title: str, description: str) -> Optional[str]:
    """Scan title, then description, return first canonical match."""
    combined_title = (title or "").lower()
    combined_desc  = (description or "").lower()
    for _pattern, canon, rx in GOLD_BRAND_PATTERNS:
        if rx.search(combined_title):
            return canon
    for _pattern, canon, rx in GOLD_BRAND_PATTERNS:
        if rx.search(combined_desc):
            return canon
    return None


# ── Gold-standard condition classifier ──────────────────────────────────────

# Broken keywords — checked first (stronger signal)
BROKEN_RE = re.compile(
    r"\b(defekt|kaputt|reparaturbedürftig|bastler|ersatzteile?|schlachtteile?"
    r"|na\s+díly|nefunk[cč]|poškozený?|havarovaný?|ne\s+funk|broken|for\s+parts"
    r"|na[\s-]?spare|brutto|auf\s+reparatur|bez\s+opravy)\b",
    re.IGNORECASE,
)

WORKING_RE = re.compile(
    r"\b(einwandfrei|voll\s+funktionsfähig|funktioniert\s+(?:tadellos|gut|sehr\s+gut|perfekt|einwandfrei)"
    r"|voll\s+funktions|bestens|top\s+zustand|funkčn[ií]|bezvadný?|plně\s+funkč"
    r"|fully\s+working|works?\s+(?:fine|great|perfectly)|läuft\s+(?:einwandfrei|gut|tadellos)"
    r"|l[áa]uft\s+(?:noch|super)|technisch\s+einwandfrei)\b",
    re.IGNORECASE,
)

DEGRADED_RE = re.compile(
    r"\b(gebrauchsspuren?|kratzer|optische\s+m[äa]ngel|normaler?\s+gebrauch"
    r"|normální\s+opot[rř]ebení|opotřebení|b[äa]uliche\s+m[äa]ngel|kosmetische\s+m[äa]ngel"
    r"|kleine\s+kratzer|leichte\s+m[äa]ngel|stopy\s+používání|viditelné?\s+stopy)\b",
    re.IGNORECASE,
)


def gold_status(title: str, description: str) -> Optional[str]:
    text = f"{title or ''} {description or ''}"
    if BROKEN_RE.search(text):
        return "broken"
    if WORKING_RE.search(text):
        return "working"
    if DEGRADED_RE.search(text):
        return "degraded"
    return None  # unknown


# ── JSONL loader ──────────────────────────────────────────────────────────────

def _jsonl_safe(text: str) -> str:
    return text.replace(" ", "\\u2028").replace(" ", "\\u2029")


def load_enriched(path: pathlib.Path) -> list[dict]:
    raw = path.read_text(encoding="utf-8")
    rows = []
    for line in _jsonl_safe(raw).splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


# ── Stratified sampling ───────────────────────────────────────────────────────

def stratified_sample(rows: list[dict], n: int, seed: int) -> list[dict]:
    """
    Sample n listings stratified by (source, category).
    Within each stratum, sample proportionally; top-up from all rows if
    a stratum is exhausted.
    """
    rng = random.Random(seed)
    strata: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        key = (r.get("source", "unknown"), r.get("categoryId", "unknown"))
        strata[key].append(r)

    per_stratum = max(1, n // len(strata))
    result = []
    for key, items in strata.items():
        k = min(per_stratum, len(items))
        result.extend(rng.sample(items, k))

    # Top-up to n
    if len(result) < n:
        remaining = [r for r in rows if r not in result]
        extra = min(n - len(result), len(remaining))
        result.extend(rng.sample(remaining, extra))

    rng.shuffle(result)
    return result[:n]


# ── Evaluation ────────────────────────────────────────────────────────────────

def evaluate_brand(sample: list[dict]) -> dict:
    """
    Compare parser brand vs gold brand.
    Treats None (unparsed) vs None (not in title/desc) as TN.
    """
    tp = fp = fn = tn = 0
    correct_match = wrong_match = extra = missed = both_none = 0
    discrepancies = []

    for r in sample:
        parser = r.get("brandParsed")
        title  = r.get("title", "")
        desc   = r.get("description", "") or ""
        gold   = gold_brand(title, desc)

        if gold is not None and parser is not None:
            if gold == parser:
                correct_match += 1
                tp += 1
            else:
                wrong_match += 1
                fp += 1
                fn += 1
                discrepancies.append({
                    "id": r.get("id", ""),
                    "source": r.get("source"),
                    "title": title[:120],
                    "parser": parser,
                    "gold": gold,
                    "issue": "brand_mismatch",
                })
        elif gold is None and parser is not None:
            extra += 1
            fp += 1
            discrepancies.append({
                "id": r.get("id", ""),
                "source": r.get("source"),
                "title": title[:120],
                "parser": parser,
                "gold": None,
                "issue": "false_positive",
            })
        elif gold is not None and parser is None:
            missed += 1
            fn += 1
            discrepancies.append({
                "id": r.get("id", ""),
                "source": r.get("source"),
                "title": title[:120],
                "parser": None,
                "gold": gold,
                "issue": "false_negative",
            })
        else:
            both_none += 1
            tn += 1

    precision = tp / (tp + fp) if (tp + fp) > 0 else float("nan")
    recall    = tp / (tp + fn) if (tp + fn) > 0 else float("nan")
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else float("nan")

    return {
        "n": len(sample),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": precision, "recall": recall, "f1": f1,
        "correct_match": correct_match,
        "wrong_match": wrong_match,
        "false_positive": extra,
        "false_negative": missed,
        "both_none": both_none,
        "discrepancies": discrepancies,
    }


def evaluate_status(sample: list[dict]) -> dict:
    """Per-class precision/recall for working/broken/degraded/unknown."""
    classes = ["working", "broken", "degraded"]
    counts = {c: {"tp": 0, "fp": 0, "fn": 0} for c in classes}
    discrepancies = []

    n_gold_known = 0
    n_agreement = 0

    for r in sample:
        parser = r.get("functionalStatus")
        title  = r.get("title", "")
        desc   = r.get("description", "") or ""
        gold   = gold_status(title, desc)

        if gold is None:
            continue  # can't evaluate if gold is undetermined

        n_gold_known += 1
        if gold == parser:
            n_agreement += 1
        else:
            discrepancies.append({
                "id": r.get("id", ""),
                "source": r.get("source"),
                "title": title[:120],
                "parser_status": parser,
                "gold_status": gold,
            })

        for c in classes:
            predicted = (parser == c)
            actual    = (gold == c)
            if predicted and actual:
                counts[c]["tp"] += 1
            elif predicted and not actual:
                counts[c]["fp"] += 1
            elif not predicted and actual:
                counts[c]["fn"] += 1

    results = {}
    for c in classes:
        tp, fp, fn = counts[c]["tp"], counts[c]["fp"], counts[c]["fn"]
        prec = tp / (tp + fp) if (tp + fp) > 0 else float("nan")
        rec  = tp / (tp + fn) if (tp + fn) > 0 else float("nan")
        f1   = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else float("nan")
        results[c] = {"tp": tp, "fp": fp, "fn": fn, "precision": prec, "recall": rec, "f1": f1}

    macro_p = sum(v["precision"] for v in results.values() if not math.isnan(v["precision"])) / 3
    macro_r = sum(v["recall"]    for v in results.values() if not math.isnan(v["recall"]))    / 3
    macro_f = sum(v["f1"]        for v in results.values() if not math.isnan(v["f1"]))        / 3

    return {
        "n_evaluable": n_gold_known,
        "n_agreement": n_agreement,
        "agreement_rate": n_agreement / n_gold_known if n_gold_known else float("nan"),
        "per_class": results,
        "macro_precision": macro_p,
        "macro_recall": macro_r,
        "macro_f1": macro_f,
        "discrepancies": discrepancies,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--enriched", type=pathlib.Path, default=None)
    parser.add_argument("--n",   type=int, default=350, help="Sample size (default 350)")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--export", type=pathlib.Path, default=None,
                        help="Write discrepancies to this CSV file")
    args = parser.parse_args()

    enriched_path = args.enriched
    if enriched_path is None:
        enriched_dir = DATA_DIR / "enriched"
        files = sorted(enriched_dir.glob("enriched_harvest_*.jsonl"), reverse=True)
        if not files:
            raise FileNotFoundError("No enriched JSONL found.")
        enriched_path = files[0]

    print(f"Enriched source : {enriched_path.name}")
    print(f"Sample size     : {args.n}  seed={args.seed}")

    rows = load_enriched(enriched_path)
    sample = stratified_sample(rows, args.n, args.seed)

    # ── Brand evaluation ──────────────────────────────────────────────────────
    br = evaluate_brand(sample)
    print(f"\n━━━ Brand-parser evaluation (n={br['n']}) ━━━")
    print(f"  Gold brand found in sample : {br['tp'] + br['fn'] + br['wrong_match']} / {br['n']}")
    print(f"  Correct matches            : {br['correct_match']}")
    print(f"  Parser assigns wrong brand : {br['wrong_match']}")
    print(f"  Parser misses known brand  : {br['false_negative']}")
    print(f"  Parser adds phantom brand  : {br['false_positive']}")
    print(f"  Both gold + parser = None  : {br['both_none']}")
    print(f"\n  Precision : {br['precision']:.3f}")
    print(f"  Recall    : {br['recall']:.3f}")
    print(f"  F1        : {br['f1']:.3f}")

    if br["discrepancies"]:
        print(f"\n  Sample of brand discrepancies ({min(8, len(br['discrepancies']))} shown):")
        for d in br["discrepancies"][:8]:
            print(f"    [{d['issue']}] src={d['source']}  parser={d['parser']}  gold={d['gold']}")
            print(f"      title: {d['title']}")

    # ── Status evaluation ─────────────────────────────────────────────────────
    st = evaluate_status(sample)
    print(f"\n━━━ Condition-classifier evaluation (n_evaluable={st['n_evaluable']}) ━━━")
    print(f"  Overall agreement rate : {st['agreement_rate']:.3f}  ({st['n_agreement']}/{st['n_evaluable']})")
    print(f"\n  Per-class results:")
    print(f"  {'Class':10s}  {'Prec':>6s}  {'Rec':>6s}  {'F1':>6s}  {'TP':>4s}  {'FP':>4s}  {'FN':>4s}")
    print(f"  {'─'*55}")
    for c, v in st["per_class"].items():
        print(
            f"  {c:10s}  {v['precision']:>6.3f}  {v['recall']:>6.3f}  {v['f1']:>6.3f}"
            f"  {v['tp']:>4d}  {v['fp']:>4d}  {v['fn']:>4d}"
        )
    print(f"\n  Macro avg     {st['macro_precision']:>6.3f}  {st['macro_recall']:>6.3f}  {st['macro_f1']:>6.3f}")

    if st["discrepancies"]:
        print(f"\n  Sample of condition discrepancies ({min(8, len(st['discrepancies']))} shown):")
        for d in st["discrepancies"][:8]:
            print(f"    src={d['source']}  parser={d['parser_status']}  gold={d['gold_status']}")
            print(f"      title: {d['title']}")

    # ── Export discrepancies ─────────────────────────────────────────────────
    if args.export:
        all_disc = []
        for d in br["discrepancies"]:
            all_disc.append({
                "classifier": "brand",
                "id": d["id"],
                "source": d["source"],
                "title": d["title"],
                "parser_output": d["parser"],
                "gold_label": d["gold"],
                "issue": d["issue"],
            })
        for d in st["discrepancies"]:
            all_disc.append({
                "classifier": "status",
                "id": d["id"],
                "source": d["source"],
                "title": d["title"],
                "parser_output": d["parser_status"],
                "gold_label": d["gold_status"],
                "issue": "status_mismatch",
            })
        args.export.parent.mkdir(parents=True, exist_ok=True)
        with args.export.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["classifier","id","source","title","parser_output","gold_label","issue"])
            writer.writeheader()
            writer.writerows(all_disc)
        print(f"\nDiscrepancies exported → {args.export}  ({len(all_disc)} rows)")

if __name__ == "__main__":
    main()
