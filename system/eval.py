#!/usr/bin/env python3
"""Score engine output against docs/labels_selfcheck.jsonl.

Official cost model:
  correct verdict -> 0
  true CLOSE predicted RFI or ESCALATE -> 3
  true RFI predicted CLOSE -> 10
  true ESCALATE predicted CLOSE -> 10
  true RFI predicted ESCALATE -> 2
  true ESCALATE predicted RFI -> 3

usage: eval.py <output.jsonl> [labels.jsonl]
"""
import json
import sys
from collections import Counter, defaultdict

COST = {
    ("CLOSE", "CLOSE"): 0, ("CLOSE", "RFI"): 3, ("CLOSE", "ESCALATE"): 3,
    ("RFI", "CLOSE"): 10, ("RFI", "RFI"): 0, ("RFI", "ESCALATE"): 2,
    ("ESCALATE", "CLOSE"): 10, ("ESCALATE", "RFI"): 3,
    ("ESCALATE", "ESCALATE"): 0,
}


def load(path):
    out = {}
    for line in open(path):
        if line.strip():
            d = json.loads(line)
            out[d["case_id"]] = d
    return out


def main():
    outfile = sys.argv[1]
    labels_path = sys.argv[2] if len(sys.argv) > 2 else \
        "docs/labels_selfcheck.jsonl"
    preds = load(outfile)
    labels = {}
    for line in open(labels_path):
        if not line.strip():
            continue
        d = json.loads(line)
        labels[d["case_id"]] = d
    inst = "?"
    for cid in labels:
        inst = cid.split("-")[0]
    total_cost = 0
    n = 0
    correct = 0
    dist = Counter()
    misses = []
    for cid, lab in labels.items():
        pred = preds.get(cid)
        if not pred:
            continue
        n += 1
        t, p = lab["verdict"], pred["verdict"]
        dist[p] += 1
        c = COST[(t, p)]
        total_cost += c
        if c == 0:
            correct += 1
        else:
            misses.append((cid, t, p, c, pred.get("reason_code")))
    print(f"{outfile}: {n} labelled cases, accuracy "
          f"{correct}/{n} = {correct/n:.1%}, cost {total_cost} "
          f"({total_cost/n:.2f}/case), predicted dist {dict(dist)}")
    for m in sorted(misses, key=lambda x: -x[3]):
        print("   MISS", m)


if __name__ == "__main__":
    main()
