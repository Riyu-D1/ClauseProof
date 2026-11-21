# ClauseProof engine

`system/run <institution folder> <output file>` reads one institution folder
(`cases.jsonl`, `alerts.jsonl`, `customers.jsonl`, `transactions.jsonl`,
`evidence.jsonl`, `evidence/*.md`, `previous_reviews.jsonl`,
`internal_list.jsonl`, `POLICY.md`) and writes one JSON line per case in the
official format:

    case_id, alert_ids, verdict, reason_code, reason, evidence

It also writes `output/traces/<institution>.jsonl` next to the output file for
the demo UI (coverage per alerted transaction, ordered checks against the
policy, a counterfactual `flip`, risk context, engine version, input hash).

Pure Python 3 standard library. No network, no LLM, no clock, no randomness;
all iteration is sorted, so outputs are byte-identical across runs
(`system/check_repro.sh` proves this 5x per institution).

## How it decides

1. **Parse evidence.** Every `evidence/*.md` is parsed deterministically into
   structured claims: payables (invoices, contracts, payment files, booking
   confirmations), refunds, life/asset events (solicitor letters, insurer
   letters, sale receipts, completion statements), gifts and loans, cash
   banking records (reconciliations, takings books, collection reports),
   own-account proof (bank statements, re-verification), company registers and
   PSC registers, group structures, device exports, fraud reports and customer
   statements (chats, notes, emails).

2. **Suspicion scan first.** Anything that looks like crime wins immediately:
   fraud reports matching incoming payments, customer statements admitting
   money-muling or third-party investing, structuring intent ("can I keep this
   under £10,000?"), refusal to explain the activity, contradictory
   source-of-funds stories, a counterparty that was dissolved before it paid,
   and devices shared across customers or used from higher-risk countries.

3. **TM22 list matches.** One matching detail never proves identity.
   Registers, PSC records and documents carrying the counterparty's date of
   birth are compared to the list entry: same person or still controlling the
   counterparty at payment time → `ESCALATE`; a different party (different
   DoB, different officers, ceased control) → `LIST_MATCH_DIFFERENT_PARTY`;
   unsettled → `RFI`.

4. **Coverage map.** Every alerted transaction is matched to evidence:
   exact amount+payee+date matching for invoices, contract stages, payment
   files and bookings; cash deposit rows against reconciliation/takings
   records; refunds against cancellation/refund letters; estate, insurance,
   settlement and sale events; gifts and loans; group companies; own-account
   transfers proven by statements or re-verification; re-deposits of earlier
   own cash withdrawals; earlier closed reviews for the same counterparty;
   declared salary and family support; routine card/ATM/DD spend and small
   transfers are materiality-exempt.

5. **Verdict.** `ESCALATE` on any suspicion. Otherwise, if every alert is
   materially covered → `CLOSE` (reason code from the dominant coverage).
   If not covered, the *shape* of the gap decides: unexplained higher-risk
   corridors, sub-threshold patterns, unexplained pass-throughs, unexplained
   early redemptions and mule-shaped many-payer flows escalate; a single
   missing document or answer (statement for a same-name account, invoice for
   a held payment, records for a cash-heavy business, list-match details,
   purpose of a payment) → `RFI`. Own-account activity at ≥5× the declared
   income/volume → `RFI_UPDATED_PROFILE`.

6. **Payments/FX specifics.** Held payments ≥£10,000 to anyone but the client
   need an invoice/contract on file (invoice for a different amount is an
   invoice mismatch → escalate); funding in the client's own name is
   own-account; group funding documented by a group structure is a group
   company.

## Optional Grok assist (`--grok`)

`system/run --grok <institution> <out>` (or just a configured
`XAI_API_KEY`) enables an opt-in reading layer in `grok_assist.py`.
Grok's only job is to read evidence the deterministic parser could not
handle — unrecognised document types with financial content, recognised
types whose fields/tables yielded nothing usable — and to gloss rule IDs
the engine does not model. It returns strict JSON (fixed schema,
temperature 0, fixed seed); answers are validated in Python and anything
invalid, timed out or missing falls back to the deterministic parse.
Grok never decides a verdict.

Determinism: every request is keyed by
`sha256(model | prompt_version | input bytes)` and the answer — success
or failure — is cached in `<outdir>/grok_cache/`. Warm runs replay the
cache and are byte-identical, including traces. Committed fixtures in
`system/grok_fixtures/` are consulted read-only. Per run: 8s timeout,
concurrency 4, budget cap 200 calls (`GROK_BUDGET`). A run writes
`grok_summary.json` (calls, cache hits, docs read) and each trace marks
Grok-read documents under `grok.docs` (`assisted_by: "grok"` + cache
key). Without a key or the flag the layer is inert: no network, no
behaviour change.

## Files

- `engine.py` — the whole engine (parser, coverage, decision, traces, flip)
- `grok_assist.py` — optional Grok reading layer (`--grok`); see above
- `run` — executable wrapper (resolves its own directory; full paths OK)
- `validate.py` — contract check: line count, legal reason codes, sentence
  count, evidence-ID existence
- `eval.py` — score against `docs/labels_selfcheck.jsonl` with the official
  asymmetric cost (wrong CLOSE 10, RFI/ESCALATE on closable 3/2, correct 0)
- `check_repro.sh` — five byte-identical runs per institution
- `caseview.py` — compact case dump used for hand adjudication

## Validation performed

- 1000 valid lines per institution, all reason codes legal, all evidence IDs
  exist (`validate.py`).
- 61 hand-adjudicated cases in `docs/labels_selfcheck.jsonl` (≥15 per
  institution, every verdict and rule family covered) — scored with the
  official cost model in `eval.py`; those are self-labelled, not ground truth.
- `check_repro.sh` — five byte-identical runs.

Runtime: about a minute per institution on a laptop (the `flip`
counterfactual re-runs each decision with one fact toggled).
