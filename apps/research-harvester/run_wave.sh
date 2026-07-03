#!/bin/zsh
# Monthly harvest wave — full pipeline: harvest → pool with all prior waves →
# enrich → re-run BDP analyses. Safe to run repeatedly; every wave is kept.
#
# Usage:  ./run_wave.sh            (from apps/research-harvester)
# Cron:   see README — schedule monthly, e.g. 1st of month, 03:40.

set -euo pipefail
cd "$(dirname "$0")"

STAMP=$(date +%Y-%m-%d_%H%M)
LOG="data/wave_${STAMP}.log"
echo "━━━ Wave ${STAMP} ━━━" | tee "$LOG"

# 1. Harvest (full CZ+DE matrix)
npx tsx src/index.ts >> "$LOG" 2>&1
NEWEST=$(ls -t data/harvest_2*.jsonl | head -1)
echo "harvested: $NEWEST" | tee -a "$LOG"

# 2. Pool all waves, dedupe by listing id (first occurrence wins)
python3 - << 'EOF' >> "$LOG" 2>&1
import json, pathlib, datetime
seen, out = set(), []
files = sorted(pathlib.Path("data").glob("harvest_2*.jsonl"))
for f in files:
    for line in f.open():
        r = json.loads(line)
        if r["id"] in seen: continue
        seen.add(r["id"]); out.append(line.rstrip("\n"))
stamp = datetime.date.today().isoformat()
dst = pathlib.Path(f"data/harvest_pooled_all_{stamp}.jsonl")
dst.write_text("\n".join(out) + "\n")
print(f"pooled {len(files)} waves → {dst} ({len(out)} unique)")
EOF
POOLED=$(ls -t data/harvest_pooled_all_*.jsonl | head -1)

# 3. Enrich + analyses
npx tsx src/enrich-run.ts --input "$POOLED" >> "$LOG" 2>&1
python3 research/hedonic_model.py --s2-json data/s2_fe.json >> "$LOG" 2>&1
python3 research/bdp_composite.py --s2-json data/s2_fe.json >> "$LOG" 2>&1
python3 research/qualitydb_validation.py --bdp-s2 data/s2_fe.json >> "$LOG" 2>&1

echo "━━━ Wave ${STAMP} complete — see $LOG ━━━" | tee -a "$LOG"
tail -5 "$LOG"
