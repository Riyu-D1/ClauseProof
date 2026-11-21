# ClauseProof — demo UI

Next.js 15 (app router, TypeScript) + Tailwind + Framer Motion + `@xyflow/react`.
Dark "obsidian" theme; verdict accents: CLOSE `#2BD47D`, RFI `#FFB020`,
ESCALATE `#FF3B5C`, neutral `#37E0D8`.

## Run

```bash
node scripts/import-traces.mjs   # build public/data/*.json
npm install
npm run dev                      # http://localhost:3000
npm run build && npm start       # production
```

## Data

`scripts/import-traces.mjs` writes `public/data/`:

- **Real mode** — if `../output/traces/<institution>.jsonl` exists, each line is
  copied through verbatim (shared trace contract). `../output/repro.json` is
  copied too if present.
- **Fixture mode** — otherwise ~12 real cases are picked from
  `../institutions/*` and plausible verdicts/coverage/checks are derived from
  the actual alerts, transactions and evidence docs. The UI shows a
  **FIXTURE DATA** badge and the repro pill is labelled *example*.

## Screens

- `/` — alert queue: institution tabs, verdict pills, per-verdict counts,
  search (`/`), proof bar (computed from loaded data), repro pill.
  `j`/`k`/`Enter` navigate, `1`–`4` switch tabs.
- `/case/[id]` — case board: customer card (declared vs observed), animated
  money-flow graph (edge width ∝ amount; green = covered with doc chip,
  pulsing crimson = unexplained; `?` on held payments), decision path
  (`checks` reveal step-by-step, quoted policy clause, PASS/FAIL/UNKNOWN),
  verdict + reason + evidence chips, and the *what would flip it* card.
  `j`/`k` move between cases, `r` replays the decision path, `esc` back.
- `GET /api/evidence?institution=<id>&doc=<DOC-ID>` — returns the real
  `institutions/*/evidence/*.md` document shown in the drawer.

## Screenshots

`docs/screens/` (repo root): `queue-bank.png`, `queue-paymentsfx.png`,
`case-close.png`, `case-escalate.png`.
