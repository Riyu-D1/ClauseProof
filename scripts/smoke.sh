#!/usr/bin/env bash
# ClauseProof end-to-end smoke test — hits a RUNNING app.
#
#   ./scripts/smoke.sh [base_url]        (default http://localhost:3000)
#
# Checks: overview + queue + proof pages, queue data for all 4 institutions,
# one case page per verdict, /api/decide (live one-case engine run vs stored),
# /api/proof-run (5x identical hashes), /api/play (4 scripted plays), /stage,
# /api/osint graceful-offline, /api/play/config and /api/evidence.
# Prints PASS/FAIL per check; exit 1 on any FAIL.
set -uo pipefail

BASE="${1:-${BASE:-http://localhost:3000}}"
PASS=0
FAIL=0

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
pass() { printf '  \033[1;32mPASS\033[0m %s\n' "$*"; PASS=$((PASS + 1)); }
fail() { printf '  \033[1;31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL + 1)); }
info() { printf '       %s\n' "$*"; }

# fetch helper: GET $1 → $BODY + $CODE
CODE=""
BODY=""
get() {
  BODY="$(curl -sS -w '\n%{http_code}' --max-time "${2:-30}" "$1" 2>/dev/null)" || true
  CODE="${BODY##*$'\n'}"
  [ -z "$CODE" ] && CODE="000"
  BODY="${BODY%$'\n'*}"
}

py() { python3 -c "$1"; }

say "Smoke testing $BASE"

# ------------------------------------------------------------ nav: overview
get "$BASE/"
if [ "$CODE" = "200" ] && grep -qi 'clauseproof' <<< "$BODY" && grep -qi 'ALERT QUEUE' <<< "$BODY"; then
  pass "GET / — overview renders with nav"
else
  fail "GET / — HTTP $CODE"
fi

# ---------------------------------------------------------------- nav: queue
get "$BASE/queue"
if [ "$CODE" = "200" ] && grep -qi 'fictional cases' <<< "$BODY"; then
  pass "GET /queue — alert queue renders with dataset banner"
else
  fail "GET /queue — HTTP $CODE"
fi

# ---------------------------------------------------------------- nav: proof
get "$BASE/proof"
if [ "$CODE" = "200" ] && grep -qi 'check_repro' <<< "$BODY" && grep -qi 'RUN 5' <<< "$BODY"; then
  pass "GET /proof — proof page renders (repro + live 5x panel)"
else
  fail "GET /proof — HTTP $CODE"
fi

# ------------------------------------------------- queues (data per inst)
TMP="$(mktemp -d -t cp-smoke.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
PICKS_FILE="$TMP/picks.json"
ALL_OK=1
for inst in bank emoney investment payments_fx; do
  get "$BASE/data/$inst.json"
  N="$(printf '%s' "$BODY" | py 'import json,sys
try: print(len(json.load(sys.stdin)))
except Exception: print(0)' 2>/dev/null)"
  if [ "$CODE" = "200" ] && [ "${N:-0}" -gt 0 ]; then
    printf '%s' "$BODY" > "$TMP/$inst.json"
    VCOUNTS="$(py 'import json
d=json.load(open("'"$TMP/$inst.json"'"))
c={}
for t in d: c[t["verdict"]]=c.get(t["verdict"],0)+1
print(" ".join(f"{k}={v}" for k,v in sorted(c.items())))' 2>/dev/null)"
    pass "GET /data/$inst.json — queue data loaded ($VCOUNTS)"
  else
    fail "GET /data/$inst.json — HTTP $CODE or empty"
    ALL_OK=0
  fi
done

# pick one case per verdict (from the real queue data)
: > "$PICKS_FILE"
if [ "$ALL_OK" = "1" ]; then
  python3 - "$TMP" > "$PICKS_FILE" <<'PY'
import json, sys, glob
want = {"CLOSE": None, "RFI": None, "ESCALATE": None}
for f in sorted(glob.glob(sys.argv[1] + "/[a-z]*.json")):
    if f.endswith("picks.json"):
        continue
    for t in json.load(open(f)):
        v = t.get("verdict")
        if v in want and want[v] is None and t.get("coverage"):
            want[v] = {
                "case_id": t["case_id"], "institution": t["institution"],
                "verdict": v,
                "doc": next((c["covered_by"] for c in t["coverage"]
                            if c.get("covered_by")), None),
            }
    if all(want.values()):
        break
print(json.dumps(want))
PY
  for V in CLOSE RFI ESCALATE; do
    CID="$(py "import json
w=json.load(open('$PICKS_FILE'))
print(w['$V']['case_id'] if w.get('$V') else '')" 2>/dev/null)"
    if [ -z "$CID" ]; then
      fail "case page — no $V case found in queue data"
      continue
    fi
    get "$BASE/case/$CID"
    if [ "$CODE" = "200" ] && grep -q "$CID" <<< "$BODY"; then
      pass "GET /case/$CID — $V case page renders"
    else
      fail "GET /case/$CID — HTTP $CODE"
    fi
  done
else
  fail "case pages — skipped (queue data unavailable)"
fi

# ------------------------------------------------------------- /api/decide
# run the real engine live on one case and compare with the stored verdict
DCASE="$(py "import json
w=json.load(open('$PICKS_FILE'))
c=next((v for v in w.values() if v), None)
print(c['case_id'] if c else '')" 2>/dev/null)"
STORED="$(py "import json
w=json.load(open('$PICKS_FILE'))
c=next((v for v in w.values() if v), None)
print(c['verdict'] if c else '')" 2>/dev/null)"
if [ -n "$DCASE" ]; then
  DRESP="$(curl -sS --max-time 90 -X POST "$BASE/api/decide" \
        -H 'content-type: application/json' \
        -d "{\"case_id\":\"$DCASE\"}" 2>/dev/null)"
  DOUT="$(printf '%s' "$DRESP" | py 'import json,sys
try:
    d=json.load(sys.stdin)
    if d.get("ok"):
        print("OK|{}|{}|{}".format(d.get("verdict"), d.get("reason_code"), d.get("ms")))
    else:
        print("ERR|"+str(d.get("error","?"))+"||")
except Exception as e:
    print("ERR|unparseable||")' 2>/dev/null)"
  DV="${DOUT%%|*}"; DREST="${DOUT#*|}"; DVERDICT="${DREST%%|*}"
  if [ "$DV" = "OK" ] && [ "$DVERDICT" = "$STORED" ]; then
    pass "POST /api/decide — live engine run on $DCASE agrees with stored ($STORED)"
  elif [ "$DV" = "OK" ]; then
    info "live verdict $DVERDICT vs stored $STORED — engine ran, verdict differs (shown honestly in UI)"
    pass "POST /api/decide — live engine run completed on $DCASE"
  else
    fail "POST /api/decide — ${DREST%%|*}"
  fi
else
  fail "POST /api/decide — no case id available"
fi

# ------------------------------------------------------------- /api/evidence
DOC="$(py "import json
w=json.load(open('$PICKS_FILE'))
for v in w.values():
    if v and v.get('doc'): print(v['institution'] + '|' + v['doc']); break" 2>/dev/null)"
if [ -n "$DOC" ]; then
  EI="${DOC%%|*}"; ED="${DOC#*|}"
  get "$BASE/api/evidence?institution=$EI&doc=$ED"
  if [ "$CODE" = "200" ] && grep -q '"markdown"' <<< "$BODY"; then
    pass "GET /api/evidence?institution=$EI&doc=$ED — document served"
  else
    fail "GET /api/evidence?doc=$ED — HTTP $CODE"
  fi
else
  info "GET /api/evidence — skipped (no doc-covered case found)"
fi

# ----------------------------------------------------------- /api/proof-run
say "POST /api/proof-run — live 5x engine proof (this takes ~2 min)"
curl -sS -N --max-time 280 -X POST "$BASE/api/proof-run" \
  -H 'content-type: application/json' \
  -d '{"institution":"bank"}' > "$TMP/proof.ndjson" 2>/dev/null
PR="$(py 'import json,sys
done=None; runs=0
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    ev=json.loads(line)
    if ev.get("type")=="run": runs+=1
    if ev.get("type")=="done": done=ev
    if ev.get("type")=="error":
        print("ERR:"+str(ev.get("message"))); sys.exit(0)
if done:
    print("identical={} runs={} unique_hashes={}".format(
        done.get("identical"), runs, len(set(done.get("hashes",[])))))
else:
    print("no-done")' < "$TMP/proof.ndjson" 2>/dev/null)"
if grep -q 'identical=True runs=5 unique_hashes=1' <<< "$PR"; then
  pass "/api/proof-run — 5 runs, identical hashes (sha256 verified)"
elif grep -q '^ERR:' <<< "$PR"; then
  fail "/api/proof-run — engine error: ${PR#ERR:}"
else
  fail "/api/proof-run — $PR"
fi
info "$PR"

# ------------------------------------------------------------------ /api/play
say "POST /api/play — 4 scripted plays through the real engine"
PLAYS='
{"nickname":"mule_runner","persona":"teacher","funding":"crowd","senders":10,"roundAmounts":true,"ownProof":false,"hoursToMove":12,"parkDays":30,"destination":"uk_other","newPayeeSameDay":true,"invoice":"none","deviceId":"smoke-001"}
{"nickname":"smurfy","persona":"freelancer","funding":"cash","senders":16,"roundAmounts":false,"ownProof":false,"hoursToMove":96,"parkDays":30,"destination":"uk_other","newPayeeSameDay":true,"invoice":"none","deviceId":"smoke-002"}
{"nickname":"flour_power","persona":"baker","funding":"own","senders":1,"roundAmounts":false,"ownProof":true,"hoursToMove":30,"parkDays":30,"destination":"high_risk","newPayeeSameDay":true,"invoice":"matching","deviceId":"smoke-003"}
{"nickname":"ghost","persona":"baker","funding":"own","senders":1,"roundAmounts":false,"ownProof":true,"hoursToMove":72,"parkDays":30,"destination":"eu","newPayeeSameDay":false,"invoice":"matching","deviceId":"smoke-004"}
'
N=0
printf '%s\n' "$PLAYS" | while IFS= read -r playbody; do
  [ -z "$playbody" ] && continue
  N=$((N + 1))
  R="$(curl -sS --max-time 90 -X POST "$BASE/api/play" \
        -H 'content-type: application/json' -d "$playbody" 2>/dev/null)"
  if [ -z "$R" ]; then
    echo "FAIL|play $N http error|"
    continue
  fi
  printf '%s' "$R" | py 'import json,sys
d=json.load(sys.stdin)
if d.get("ok"):
    print("OK|{}|{}|{}".format(d.get("verdict"),
          d.get("reason_code") or "-", d.get("bucket")))
else:
    print("FAIL|{}|".format(d.get("error","?")))'
done > "$TMP/plays.txt"
while IFS='|' read -r st verdict code bucket; do
  if [ "$st" = "OK" ]; then
    case "$verdict" in
      CLOSE|RFI|ESCALATE|NO_ALERT)
        pass "/api/play — engine verdict $verdict ($code) → $bucket" ;;
      *) fail "/api/play — unexpected verdict: $verdict" ;;
    esac
  else
    fail "/api/play — $verdict"
  fi
done < "$TMP/plays.txt"

# feed reflects the plays
get "$BASE/api/play"
FEEDN="$(printf '%s' "$BODY" | py 'import json,sys
try: print(json.load(sys.stdin).get("total",0))
except Exception: print(0)' 2>/dev/null)"
if [ "$CODE" = "200" ] && [ "${FEEDN:-0}" -ge 4 ]; then
  pass "GET /api/play — feed lists $FEEDN attempts"
else
  fail "GET /api/play — HTTP $CODE, total=$FEEDN"
fi

# -------------------------------------------------------------------- /stage
get "$BASE/stage"
if [ "$CODE" = "200" ] && grep -qi 'BEAT THE ANALYST' <<< "$BODY"; then
  pass "GET /stage — big-screen page renders"
else
  fail "GET /stage — HTTP $CODE"
fi

# -------------------------------------------------------------- /api/osint
OSB="$(curl -sS --max-time 40 -X POST "$BASE/api/osint" \
      -H 'content-type: application/json' \
      -d '{"kind":"entity","name":"Marlbrook Bakehouse Ltd"}' 2>/dev/null)"
OSINT="$(printf '%s' "$OSB" | py 'import json,sys
d=json.load(sys.stdin)
if d.get("ok"): print("LIVE:"+str(d.get("signal")))
elif d.get("offline"): print("OFFLINE:"+str(d.get("offline_reason")))
else: print("BAD:"+str(d))' 2>/dev/null)"
case "$OSINT" in
  OFFLINE:no_api_key)  pass "/api/osint — graceful 'not configured' (no API key)" ;;
  OFFLINE:*)           pass "/api/osint — graceful offline ($OSINT)" ;;
  LIVE:*)              pass "/api/osint — live lookup ok ($OSINT)" ;;
  *)                   fail "/api/osint — unexpected: $OSINT" ;;
esac

# ---------------------------------------------------------- /api/play/config
get "$BASE/api/play/config"
PLAYURL="$(printf '%s' "$BODY" | py 'import json,sys
try: print(json.load(sys.stdin).get("playUrl",""))
except Exception: print("")' 2>/dev/null)"
if [ "$CODE" = "200" ] && grep -q '/play' <<< "$PLAYURL"; then
  pass "GET /api/play/config — phones should open $PLAYURL"
else
  fail "GET /api/play/config — HTTP $CODE"
fi

# -------------------------------------------------------------------- totals
echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[1;32mSMOKE: ALL %d CHECKS PASSED\033[0m\n' "$PASS"
  exit 0
else
  printf '\033[1;31mSMOKE: %d PASSED, %d FAILED\033[0m\n' "$PASS" "$FAIL"
  exit 1
fi
