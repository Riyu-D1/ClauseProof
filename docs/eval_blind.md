# Blind-label evaluation (independent QA)

**Important:** all numbers below are measured against `docs/labels_blind.jsonl`,
an independent analyst-authored label set (100 cases, 25 per institution,
deterministic stratified sample excluding every `docs/labels_selfcheck.jsonl`
case). They are **not** official hackathon results.

Official cost model used: wrong `CLOSE` on a case needing `RFI`/`ESCALATE` = 10;
`RFI`/`ESCALATE` on a closable case = 3; `RFI` on an `ESCALATE` case = 3;
`ESCALATE` on an `RFI` case = 2.

## Deterministic holdout protocol

60 train / 40 holdout, fixed by `md5("blindcheck:" + case_id)` ordering —
the 40 lowest hash values form the holdout. Engine changes were driven by
policy principles (document parsing, own-account proof, counterparty history),
never by case_id, customer name or exact wording.

## Results

| split | metric | before | after |
|---|---|---|---|
| all 100 | verdict accuracy | 88/100 (88.0%) | 97/100 (97.0%) |
| all 100 | reason-code accuracy | 70/100 (70.0%) | 75/100 (75.0%) |
| all 100 | official cost | 62 (0.620/case) | 7 (0.070/case) |
| train 60 | verdict accuracy | 53/60 (88.3%) | 58/60 (96.7%) |
| train 60 | official cost | 34 (0.567/case) | 5 (0.083/case) |
| holdout 40 | verdict accuracy | 35/40 (87.5%) | 39/40 (97.5%) |
| holdout 40 | official cost | 28 (0.700/case) | 2 (0.050/case) |

The holdout improved at least as much as the train split, and wrong `CLOSE`
decisions dropped from 4 (cost 40) to 0 on all 100 labels.

## Changes made (general principles only)

1. **Own-account requires a document** (`own_account_cov`): removed the
   unconditional rule that a same-name external account counts as the
   customer's own for investment and payments_fx. All four policies state it
   counts "only when a document on file shows the customer holds it". This
   eliminated all four wrong `CLOSE`s. For payments_fx, inbound funding in
   the client's own name is the declared funding channel (`WITHIN_PROFILE`).
2. **Ownership attestation in refund/event docs** (`_extract_refund`,
   `own_account_cov`): a document stating funds moved to an account "in your
   name" / "the customer's own account" proves ownership for that amount
   (e.g. a cancellation letter returning a subscription to the customer's
   own account).
3. **Invoice payee extraction** (`_extract_invoice`): when "Pay to" is only
   account details (IBAN/account number), the named supplier/carrier field
   or title is used instead.
4. **Receivable invoices** (`_extract_multi_invoice`, `match_receivable`):
   multi-invoice tables with a billed-party column (exporter/customer/payer)
   are the client's own issued invoices, so they explain money coming in.
5. **Established counterparty** (`established_counterparty`): a business
   paying a counterparty it has paid ≥3 times before, in a declared country,
   is within profile.
6. **Conduit detection** (`choose_gap_verdict`): a business account taking
   unexplained third-party funding and disbursing to ≥5 distinct individual
   payees escalates as `ESC_THIRD_PARTY_FUNDING` (policy: "unrelated third
   parties fund the account or receive money from it").

## Residual disagreements (all cost ≤3)

- `IV-CS425188` — engine `ESCALATE`/`ESC_EARLY_REDEMPTION`, label
  `RFI`/`RFI_SOURCE_OF_FUNDS` (cost 2). Lone early redemption to unproven
  same-name accounts; the engine's escalation is defensible.
- `PX-CS207975` — engine `RFI`/`RFI_BUSINESS_RECORDS`, label
  `CLOSE`/`WITHIN_PROFILE` (cost 3). Routine freelancer payouts matching the
  declared model; engine prefers asking for records.
- `PX-CS611631` — engine `ESCALATE`/`ESC_STRUCTURING`, label
  `RFI`/`RFI_PURPOSE_DOCUMENTS` (cost 2). Repeated sub-£10k stage payments;
  engine escalates on morphology, label asks for the contract first.

## Reproduction

```
system/run institutions/<inst> output/<inst>.jsonl   # all 4 institutions
python3 system/validate.py institutions/<inst> output/<inst>.jsonl
bash system/check_repro.sh                            # 5 runs per institution
```
