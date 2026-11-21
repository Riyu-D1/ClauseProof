#!/usr/bin/env node
// Proof script: submits 4 scripted plays to a running web server and prints
// the REAL engine verdicts. Usage:
//   node scripts/proof-plays.mjs [baseUrl]     (default http://localhost:3000)

const BASE = process.argv[2] ?? "http://localhost:3000";

const PLAYS = [
  {
    label: "1 · Obvious mule",
    body: {
      nickname: "mule_runner",
      persona: "teacher",
      funding: "crowd",
      senders: 10,
      roundAmounts: true,
      ownProof: false,
      hoursToMove: 12,
      parkDays: 30,
      destination: "uk_other",
      newPayeeSameDay: true,
      invoice: "none",
      deviceId: "proof-script-01",
    },
  },
  {
    label: "2 · Structuring under the counter",
    body: {
      nickname: "smurfy",
      persona: "freelancer",
      funding: "cash",
      senders: 16,
      roundAmounts: false,
      ownProof: false,
      hoursToMove: 96,
      parkDays: 30,
      destination: "uk_other",
      newPayeeSameDay: true,
      invoice: "none",
      deviceId: "proof-script-02",
    },
  },
  {
    label: "3 · Documented legitimate invoice",
    body: {
      nickname: "flour_power",
      persona: "baker",
      funding: "own",
      senders: 1,
      roundAmounts: false,
      ownProof: true,
      hoursToMove: 30,
      parkDays: 30,
      destination: "high_risk",
      newPayeeSameDay: true,
      invoice: "matching",
      deviceId: "proof-script-03",
    },
  },
  {
    label: "4 · Sneaky one (the quiet escape)",
    body: {
      nickname: "ghost",
      persona: "baker",
      funding: "own",
      senders: 1,
      roundAmounts: false,
      ownProof: true,
      hoursToMove: 72,
      parkDays: 30,
      destination: "eu",
      newPayeeSameDay: false,
      invoice: "matching",
      deviceId: "proof-script-04",
    },
  },
];

const res = await fetch(`${BASE}/api/play/config`);
if (!res.ok) {
  console.error(`cannot reach ${BASE} — is the server running?`);
  process.exit(1);
}

for (const play of PLAYS) {
  const r = await fetch(`${BASE}/api/play`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(play.body),
  });
  const d = await r.json();
  console.log(`\n=== ${play.label} ===`);
  if (!r.ok) {
    console.log(`  API error ${r.status}: ${d.error}`);
    continue;
  }
  console.log(`  play:        ${d.summary}`);
  console.log(`  alerts fired: ${d.alerts.length ? d.alerts.map((a) => a.rule_id).join(", ") : "none"}`);
  console.log(`  verdict:     ${d.verdict}${d.reason_code ? ` (${d.reason_code})` : ""}  →  ${d.bucket}`);
  console.log(`  reason:      ${d.reason}`);
  if (d.flip) console.log(`  flip:        ${d.flip.change} → ${d.flip.new_verdict}`);
}
console.log();
