#!/usr/bin/env python3
"""Compact case dump for hand adjudication."""
import json
import sys
import os

folder = sys.argv[1]
want = set(sys.argv[2:])
cases = {c["case_id"]: c for c in
         map(json.loads, open(f"{folder}/cases.jsonl"))}
alerts = {a["alert_id"]: a for a in
          map(json.loads, open(f"{folder}/alerts.jsonl"))}
custs = {c["customer_id"]: c for c in
         map(json.loads, open(f"{folder}/customers.jsonl"))}
txns = {t["transaction_id"]: t for t in
        map(json.loads, open(f"{folder}/transactions.jsonl"))}
evs = {}
for e in map(json.loads, open(f"{folder}/evidence.jsonl")):
    evs.setdefault(e["customer_id"], []).append(e)
revs = {}
for r in map(json.loads, open(f"{folder}/previous_reviews.jsonl")):
    revs.setdefault(r["customer_id"], []).append(r)

for cid in sorted(want):
    c = cases[cid]
    cu = custs[c["customer_id"]]
    print(f"\n{'='*70}\n{cid} {cu['name']} [{cu['kind']}] "
          f"occ={cu.get('occupation') or cu.get('business_activity')} "
          f"inc={cu.get('declared',{}).get('monthly_income_gbp')}"
          f"turn={cu.get('declared',{}).get('annual_turnover_gbp')}")
    print(" declared:", json.dumps(cu.get("declared", {}))[:300])
    for aid in c["alert_ids"]:
        a = alerts[aid]
        print(f" {a['rule_id']}: {a['message'][:180]}")
    alert_tids = set(t for aid in c["alert_ids"]
                     for t in alerts[aid]["transaction_ids"])
    if c.get("held_payment_id"):
        alert_tids.add(c["held_payment_id"])
    for tid in sorted(alert_tids):
        t = txns[tid]
        print(f"  txn {t['direction']:>3} {t['amount_gbp']:>9.2f} "
              f"{t['channel']:<15} {str(t['counterparty_name'])[:30]:<30} "
              f"{t['counterparty_country'][:16]:<16} "
              f"{t['booked_at'][:10]} ref={t.get('reference')}")
    for r in revs.get(c["customer_id"], []):
        print(f"  REVIEW {r['review_id']} {r['rule_id']} {r['verdict']}: "
              f"{r['note'][:150]}")
    for e in evs.get(c["customer_id"], []):
        if e["type"] in ("due_diligence_summary", "proof_of_address"):
            continue
        txt = open(os.path.join(folder, e["file"])).read()
        body = "\n".join(txt.split("\n")[4:]).strip()
        print(f"  --- {e['doc_id']} {e['type']} ({e['title'][:60]})")
        print("      " + body.replace("\n", " ")[:600])
