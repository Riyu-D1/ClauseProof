#!/usr/bin/env python3
"""Validate ClauseProof output files against the official contract."""
import json
import os
import re
import sys

CLOSE_CODES = {
    "COLLECTION_DOCUMENTED", "BUSINESS_RECORDS_RECONCILE", "DOCUMENTED_EVENT",
    "INVOICE_MATCHES", "OWN_ACCOUNT", "GROUP_COMPANY",
    "THIRD_PARTY_DOCUMENTED", "REFUND_OF_EARLIER_PAYMENT",
    "RETURNING_CUSTOMER", "LIST_MATCH_DIFFERENT_PARTY", "WITHIN_PROFILE",
}
RFI_CODES = {
    "RFI_PURPOSE_DOCUMENTS", "RFI_BUSINESS_RECORDS", "RFI_SOURCE_OF_FUNDS",
    "RFI_COUNTERPARTY_DETAILS", "RFI_UPDATED_PROFILE",
}
ESC_CODES = {
    "ESC_MULE_ACTIVITY", "ESC_STRUCTURING", "ESC_UNEXPLAINED_FUNDS",
    "ESC_PASS_THROUGH", "ESC_INVOICE_MISMATCH", "ESC_HIGH_RISK_CORRIDOR",
    "ESC_ACCOUNT_MISUSE", "ESC_THIRD_PARTY_FUNDING", "ESC_EARLY_REDEMPTION",
    "ESC_LISTED_PARTY",
}
LEGAL = {"CLOSE": CLOSE_CODES, "RFI": RFI_CODES, "ESCALATE": ESC_CODES}
FIELDS = ["case_id", "alert_ids", "verdict", "reason_code", "reason",
          "evidence"]


def load_ids(folder):
    ids = set()
    for name in ("transactions.jsonl", "evidence.jsonl",
                 "internal_list.jsonl", "previous_reviews.jsonl",
                 "alerts.jsonl"):
        key = {"transactions.jsonl": "transaction_id",
               "evidence.jsonl": "doc_id",
               "internal_list.jsonl": "entry_id",
               "previous_reviews.jsonl": "review_id",
               "alerts.jsonl": "alert_id"}[name]
        with open(os.path.join(folder, name)) as f:
            for line in f:
                if line.strip():
                    ids.add(json.loads(line)[key])
    return ids


def sentence_count(reason):
    parts = [p for p in re.split(r"(?<=[.!?])\s+", reason.strip()) if p]
    return len(parts)


def main():
    folder, outfile = sys.argv[1], sys.argv[2]
    cases = [json.loads(l) for l in open(os.path.join(folder, "cases.jsonl"))
             if l.strip()]
    known_ids = load_ids(folder)
    errors = []
    seen = set()
    n = 0
    with open(outfile) as f:
        for i, line in enumerate(f, 1):
            n += 1
            try:
                d = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"line {i}: bad JSON {e}")
                continue
            for k in FIELDS:
                if k not in d:
                    errors.append(f"line {i}: missing {k}")
            cid = d.get("case_id")
            if cid in seen:
                errors.append(f"line {i}: duplicate case_id {cid}")
            seen.add(cid)
            if d.get("verdict") not in LEGAL:
                errors.append(f"line {i} {cid}: bad verdict")
                continue
            if d.get("reason_code") not in LEGAL[d["verdict"]]:
                errors.append(f"line {i} {cid}: reason_code "
                              f"{d.get('reason_code')} not legal for "
                              f"{d['verdict']}")
            sc = sentence_count(d.get("reason", ""))
            if not (1 <= sc <= 5):
                errors.append(f"line {i} {cid}: reason has {sc} sentences")
            if not isinstance(d.get("evidence"), list) or not d["evidence"]:
                errors.append(f"line {i} {cid}: empty evidence")
            for e in d.get("evidence", []):
                if e not in known_ids:
                    errors.append(f"line {i} {cid}: unknown evidence id {e}")
            if d.get("alert_ids") != cases[i - 1].get("alert_ids") \
                    if i - 1 < len(cases) else False:
                errors.append(f"line {i} {cid}: alert_ids mismatch")
    if n != len(cases):
        errors.append(f"{n} lines != {len(cases)} cases")
    for e in errors[:40]:
        print("ERR", e)
    print(f"{os.path.basename(outfile)}: {n} lines, {len(errors)} errors")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
