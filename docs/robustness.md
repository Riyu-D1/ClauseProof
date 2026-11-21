# Engine robustness report (riyansh/harden)

All numbers below are measured from real runs on this branch. Anything
not yet measured is labelled as such.

## Hardening changes (system/engine.py)

- `load_jsonl`: reads bytes, decodes UTF-8 with replacement, strips BOM,
  tolerates CRLF, skips blank/malformed/non-object lines with a capped
  stderr warning (`_warn`, max 40), returns `[]` for missing/unreadable
  files. Optional files (`previous_reviews.jsonl`, `internal_list.jsonl`,
  evidence subfiles) are fully optional.
- Schema normalisation for every record type (`_s`, `_sopt`, `_num`,
  `_strlist`, `_sdict`, `isodate`): extra fields ignored, missing fields
  get safe defaults, type-confused values coerced.
- `_num` now parses currency strings (`"£9,999.99"`); before, they
  parsed as 0.0 which made uncovered amounts look immaterial.
- `parse_date_text` uses `_mkdate`: impossible dates return `None`
  instead of raising.
- Policy profile detected from `POLICY.md` content
  (`holds_payments` from held-payment SOP phrases), not folder name.
  Unknown institutions fall back to the generic rule set; unknown rule
  IDs get a safe gap instead of a crash.
- Per-case crash isolation in `main()`: an exception in one case emits a
  safe `RFI` line and processing continues. Exactly one official JSONL
  line per input case; `alert_ids` echo the case input.
- Close gate hardened: requires alerts present, zero gaps, full
  coverage — `all([])` no longer closes zero-alert cases, and a missing
  held-payment explanation blocks `CLOSE`.
- `same_person` strips company suffixes before comparing ("Ltd" is not a
  surname): two different companies sharing a first initial can no
  longer match as the same person.
- `finish()` sanitises output: official fields only, legal reason codes
  per verdict, evidence filtered to IDs that exist in input, reason
  padded to 2-4 sentences.
- Deterministic ordering: explicit sorts on evidence/docs/alerts/
  transactions/reviews; locale-independent `dstr`/`MONTH_NAMES`; no use
  of current time, set order, or `PYTHONHASHSEED`-dependent ordering.

## Measured results

### Baseline preservation
After all hardening, re-runs of all four dev institutions are
byte-identical to the pre-hardening outputs
(`output/{bank,emoney,investment,payments_fx}.jsonl`, all `IDENTICAL`
by `md5`), so the blind-eval score is unchanged: **97/100, cost 7**
(baseline measured before hardening).

### Determinism
- Synthetic malformed corpus output MD5
  `51320c277b511f62110d99176cf6cb23` — identical across
  `PYTHONHASHSEED=0,1,42` × `TZ=America/New_York,Asia/Tokyo,UTC`,
  run from a different cwd.
- Real `investment` output MD5 `5f75cef87982a98a2e62fdeff22ac846` —
  identical across seed/TZ combinations.
- `LC_ALL` locale variants also byte-identical.

### Malformed / hostile inputs
Corrupted corpus (120 cases: missing held-payment refs, alerts with
missing transaction refs, non-UTF8 bytes, CRLF, empty files, extra
fields, unknown rule IDs, type-confused fields): **120/120 lines
emitted**, all schema-valid, malformed rows skipped with stderr
warnings; affected cases get `RFI`/`ESCALATE`, never `CLOSE` without
evidence. Verified after fixes: held-payment gaps and zero-alert cases
no longer close.

Missing `evidence/` dir, empty `transactions.jsonl`, absent optional
files, symlinked folders and paths with spaces: all run to completion
with one valid line per case.

### Performance
- Dev institutions: ~17.5–22.3 s per 1000 cases (baseline timing).
- 36 MB synthetic stress file: 9.24 s.

### Perturbation generalisation
`system/perturb.py` renames every name token (preserving initials and
keyword vocabulary), shifts all written + ISO dates +5 months, rescales
GBP amounts ×1.004, rotates ID digits, shuffles line order, and renames
evidence files/IDs consistently.

Latest completed run — verdict agreement vs unperturbed output:

| institution   | agreement |
|---------------|-----------|
| bank          | 1000/1000 = 100.00% |
| emoney        | 1000/1000 = 100.00% |
| investment    | 954/1000  = 95.40% |
| payments_fx   | 994/1000  = 99.40% |

Residual diffs under investigation: investment `OWN_ACCOUNT`→RFI
(own-name evidence phrasing after renaming) and isolated payments_fx
threshold crossings. Earlier harness artefacts (all-synthetic `Zz`
initials breaking `same_person`; unshifted ISO `booked_at`) are fixed;
the `same_person` company-suffix fix above was found by this harness.

## Commands used for the measurements

```
./system/run institutions/<inst> /tmp/out.jsonl
md5 /tmp/out.jsonl output/<inst>.jsonl
PYTHONHASHSEED={0,1,42} TZ={UTC,America/New_York,Asia/Tokyo} \
  ./system/run /tmp/cp_bad /tmp/out.jsonl && md5 /tmp/out.jsonl
python3 system/perturb.py institutions/<inst> /tmp/cp_pert/<inst>
./system/run /tmp/cp_pert/<inst> /tmp/cp_pert/<inst>_out.jsonl
python3 system/eval.py output/<inst>.jsonl docs/labels_blind.jsonl
python3 system/validate.py institutions/<inst> output/<inst>.jsonl
```
