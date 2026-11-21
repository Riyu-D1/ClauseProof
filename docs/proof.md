# ClauseProof — proof of correctness and reproducibility

Everything on this page is measured output from real runs on this machine
(macOS, Python 3.9, engine `ENGINE_VERSION=1.0.0`). Nothing here is example
data. Where a number comes from our own hand-labelled set rather than the
official scoring, it says so explicitly.

## 1. Output contract — `system/validate.py`

`output/<inst>.jsonl` was regenerated with the current engine and validated
against the official contract (line count, legal verdict/reason-code pairs,
2–4 sentence reasons, every evidence ID exists in the institution's files):

```
$ for i in bank emoney investment payments_fx; do
    python3 system/validate.py institutions/$i output/$i.jsonl; done
bank.jsonl: 1000 lines, 0 errors
emoney.jsonl: 1000 lines, 0 errors
investment.jsonl: 1000 lines, 0 errors
payments_fx.jsonl: 1000 lines, 0 errors
```

## 2. Reproducibility — `system/check_repro.sh`

Five consecutive runs per institution, outputs compared byte-for-byte:

```
$ bash system/check_repro.sh
bank: 5 runs byte-identical
emoney: 5 runs byte-identical
investment: 5 runs byte-identical
payments_fx: 5 runs byte-identical
```

SHA-256 of the current `output/*.jsonl`:

| institution | sha256 |
|---|---|
| bank | `c2056447c93d2b41acbc391cecd48b2171afde21976ec166213cfa3d47b0ef87` |
| emoney | `95e624d021a26add0f5c7d4b27b386fec523489503dbca818d3fc955ceb2c500` |
| investment | `5a61e7b107481909ef7b4d5da7cf42bdd5ff89cc4065b4180c7796b18848370e` |
| payments_fx | `8284c2d02add07955428c6473ba82832fed79a50f03c3d1ddf9fe0414d2572da` |

`output/repro.json` records the same result for the demo UI's repro pill.

The engine is deterministic by construction: pure Python stdlib, no LLM, no
clock, no RNG, and every iteration over cases/documents/transactions is
sorted. `check_repro.sh` is the empirical proof.

## 3. Live API proof — `POST /api/proof-run`

The running web app re-runs the real engine 5× on a chosen institution into a
temp dir and SHA-256s each output (the "RUN 5×" button on the queue):

```
identical=True runs=5 unique_hashes=1
```

## 4. End-to-end smoke — `scripts/smoke.sh`

18 checks against the running app (home, 4 institution queues, one case page
per verdict, evidence API, live 5× proof, 4 scripted plays through the real
engine, stage page, OSINT graceful-offline, LAN play URL):

```
SMOKE: ALL 18 CHECKS PASSED
```

## 5. Verdict split on the 4,000 development cases

Counted from `output/*.jsonl` (the files the judges' own run will be checked
against):

| institution | CLOSE | RFI | ESCALATE |
|---|---|---|---|
| bank | 472 | 178 | 350 |
| emoney | 500 | 166 | 334 |
| investment | 497 | 181 | 322 |
| payments_fx | 615 | 117 | 268 |
| **total (4000)** | **2084** | **642** | **1274** |

## 6. Accuracy — our own independent labels (NOT official)

Full methodology and per-case disagreements: [`eval_blind.md`](eval_blind.md).
The label set (`docs/labels_blind.jsonl`, 100 cases, 25 per institution) was
written by us and is **not** the official answer key. Official cost model:
wrong `CLOSE` = 10; `RFI`/`ESCALATE` on closable = 3; `RFI` on escalate = 3;
`ESCALATE` on `RFI` = 2.

| split | verdict accuracy | official cost |
|---|---|---|
| all 100 labels | 97/100 (97.0%) | 7 (0.070/case) |
| train 60 | 58/60 (96.7%) | 5 (0.083/case) |
| holdout 40 | 39/40 (97.5%) | 2 (0.050/case) |

Wrongful `CLOSE` decisions on those 100 labels: **0** (down from 4 before the
tuning pass documented in `eval_blind.md`). The three residual disagreements
all cost ≤3 and are defensible judgement calls, listed case-by-case in
`eval_blind.md`.

## Reproduce all of it

```bash
./start.sh                                  # everything, one command
./scripts/smoke.sh                          # 18 end-to-end checks

system/run institutions/<inst> output/<inst>.jsonl   # engine alone
python3 system/validate.py institutions/<inst> output/<inst>.jsonl
bash system/check_repro.sh                  # 20 runs, byte-diffed
```
