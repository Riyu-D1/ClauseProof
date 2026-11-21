# ClauseProof — demo runbook

One command brings the whole product up:

```bash
./start.sh                 # or ./start.sh --tunnel for a public URL
```

Open **http://localhost:3000**. The queue's first tab is **DEMO** — five
curated cases, one per story beat, chosen deterministically by
`web/scripts/pick-demo.mjs`. The case IDs below are the current picks; the
DEMO tab always shows whatever the current engine produced.

## The 3-minute live demo

**0:00 – 0:20 · The queue.** Point at the proof bar: 4,000 development cases
triaged across the four institutions, verdict split live. Say: "Every one of
these got a verdict, a reason code, a 2–4 sentence reason and evidence IDs —
written by a deterministic engine, not a model." Switch an institution tab
(1–4 keys) to show the queue is real data, all of it.

**0:20 – 0:50 · A clean CLOSE.** Open `BK-CS118489` (Nico Dunworth, bank).
Three flagged transactions, all green. Walk the decision path — each step
quotes the institution's `POLICY.md` clause it checked. Click the `INV-4407`
evidence chip — the actual invoice markdown opens in the drawer, amount,
payee and date matching. Then the flip card: "remove INV-4407 → RFI". Say:
"the engine doesn't just say yes — it shows the one fact that decides it."

**0:50 – 1:20 · An honest RFI.** Open `EM-CS165261` (Jesse Kelcombe,
e-money). One edge pulses — unexplained but not suspicious. The reason says
exactly what to ask the customer for. Flip card: "the requested document on
file → CLOSE". This is the middle ground a rules engine should find — not
lazy escalation, not a risky close.

**1:20 – 1:55 · The mule.** Open `PX-CS313282` (Talridge Fresh Produce,
payments & FX). 40 transactions, 34 counterparties, £133k washing through.
The graph is the story — red edges everywhere, pass-through pattern,
`ESC_PASS_THROUGH`, straight to the MLRO. (Optional if time allows:
`IV-CS106722` — a TM22 list match where the evidence shows the counterparty
*is* the listed party, `ESC_LISTED_PARTY`.)

**1:55 – 2:15 · Prove it's deterministic.** Back on the queue, press
**RUN 5×** on the proof bar. The app re-runs `system/run` five times into a
temp dir and streams a SHA-256 per run — watch them land identical, 5/5.
"Same input, byte-identical output. That's what a regulator wants from
triage."

**2:15 – 3:00 · Beat the Analyst.** Open **http://localhost:3000/stage** on
the projector (or second window) — the QR is already up. A volunteer scans
it, gets £15,000 of scam money, picks how to launder it. Their file hits the
real engine; the verdict lands on the stage screen live — CAUGHT /
QUESTIONED / GOT AWAY, with the rules that fired and what would have caught
them. Leaderboard fills as people play.

## The 2-minute video

Same arc, tighter:

| time | shot |
|---|---|
| 0:00–0:15 | queue, verdict counts, institution tabs |
| 0:15–0:40 | `BK-CS118489` — green graph, decision path, INV-4407 doc, flip card |
| 0:40–0:55 | `PX-CS313282` — mule graph, escalate reason |
| 0:55–1:15 | RUN 5× — five identical hashes stream in |
| 1:15–2:00 | `/stage` QR → phone play → verdict lands live on the board |

Existing screen captures in `docs/screens/` (`queue-bank`, `case-close`,
`case-escalate`, `case-flip`, `proof-5x`, `game-play`, `game-stage`,
`osint`) can fill any gaps in the edit. `web/scripts/demo-shots.mjs` and
`game-shots.mjs` re-shoot them with Playwright if the UI changed.

## If Wi-Fi fails — fallbacks, in order

1. **Hotspot.** Put the laptop and the phones on one phone's hotspot and
   re-run `./start.sh`. The LAN URL always follows the default-route
   interface, so the printed URL and the QR are right automatically.
2. **Simulate the players.** No phones needed: with `/stage` on screen, run
   `cd web && node scripts/proof-plays.mjs` from the laptop — it posts four
   scripted schemes (mule, structuring, a clean invoice, a quiet escape) to
   `/api/play`; each verdict lands on the stage board live, exactly as a
   phone play would.
3. **`--tunnel`.** If the laptop has outbound internet but the venue LAN
   blocks peer traffic, `./start.sh --tunnel` opens a public URL
   (cloudflared/localtunnel); the stage QR uses it automatically.
4. **Screenshots.** `docs/screens/` has the whole story pre-captured —
   queue, close, escalate, flip, 5× proof, play, stage — talk the deck.

## Practical notes

- First boot does `npm ci` + `next build` (≈1–2 min); later boots reuse
  everything and skip the engine entirely when inputs are unchanged.
- The engine runs ~20 s per institution — RUN 5× on one institution is about
  a minute on stage; say the sentence while it streams.
- `/api/osint` (the OSINT side panel on a case) needs a `TAVILY_API_KEY` in
  the repo-root `.env`; without it the panel shows a clean "not configured"
  state — that is the intended graceful-offline behaviour, not a bug.
- Everything except OSINT works fully offline — the engine never touches the
  network.
