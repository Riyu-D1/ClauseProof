#!/usr/bin/env bash
# Reproducibility check: run the engine 5x per institution and diff outputs.
# usage: system/check_repro.sh [institutions_root]
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)/institutions}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
status=0
for inst in bank emoney investment payments_fx; do
  for i in 1 2 3 4 5; do
    "$HERE/run" "$ROOT/$inst" "$TMP/${inst}_$i.jsonl"
  done
  for i in 2 3 4 5; do
    if ! cmp -s "$TMP/${inst}_1.jsonl" "$TMP/${inst}_$i.jsonl"; then
      echo "FAIL: $inst run $i differs"
      status=1
    fi
  done
  [ "$status" -eq 0 ] && echo "$inst: 5 runs byte-identical"
done
exit "$status"
