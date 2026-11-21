#!/usr/bin/env node
/**
 * pick-demo.mjs — deterministic showcase selection → web/public/data/demo.json
 *
 * Reads the imported real traces in public/data/<inst>.json (run
 * import-traces.mjs first) and picks five demo cases:
 *
 *   1. close_invoice  — CLOSE where an invoice covers the flagged activity
 *      end to end (every coverage row green), flip available.
 *   2. rfi            — an RFI where one document would settle it (flip→CLOSE).
 *   3. mule           — ESCALATE with a striking money-flow: many distinct
 *      counterparties / a pass-through pattern.
 *   4. held_fx        — a payments_fx case with a held outgoing payment.
 *   5. tm22           — an internal-list (TM22) case.
 *
 * Selection is fully deterministic: candidates are scored on fixed criteria
 * and ties break on case_id. Preference: non-null flip, readable case size.
 *
 * Usage: node scripts/pick-demo.mjs   (run from web/)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(WEB, "public", "data");
const INSTITUTIONS = ["bank", "emoney", "investment", "payments_fx"];

const DOC_ID = /^[A-Z]{2,5}-\d+$/;
const allCovered = (t) => t.coverage.length > 0 && t.coverage.every((c) => c.covered_by);
const uncovered = (t) => t.coverage.filter((c) => !c.covered_by).length;
const distinctCp = (t) => new Set(t.coverage.map((c) => c.counterparty)).size;
const totalFlagged = (t) => t.coverage.reduce((s, c) => s + c.amount_gbp, 0);
const hasFlip = (t) => !!t.flip;
const MULE_CODES = new Set(["ESC_MULE_ACTIVITY", "ESC_PASS_THROUGH", "ESC_THIRD_PARTY_FUNDING"]);

const SLOTS = [
  {
    key: "close_invoice",
    label: "CLOSE — invoice covers it",
    pred: (t) =>
      t.verdict === "CLOSE" && t.reason_code === "INVOICE_MATCHES" && allCovered(t),
    // ideal: 2–5 rows so the graph reads instantly; flip preferred
    score: (t) => [
      hasFlip(t) ? 1 : 0,
      -Math.abs(3 - t.coverage.length),
      t.coverage.length <= 6 ? 1 : 0,
    ],
    blurb: (t) => {
      const docIds = t.coverage.map((c) => c.covered_by).filter((x) => x && DOC_ID.test(x));
      const doc = docIds.find((d) => t.flip?.change?.includes(d)) ?? docIds[0];
      return `${doc ?? "One invoice"} matches amount, payee and date — every edge turns green.`;
    },
  },
  {
    key: "rfi",
    label: "RFI — one document settles it",
    pred: (t) => t.verdict === "RFI" && uncovered(t) >= 1,
    score: (t) => [
      hasFlip(t) && t.flip.new_verdict === "CLOSE" ? 1 : 0,
      -Math.abs(3 - t.coverage.length),
      -(uncovered(t)),
    ],
    blurb: (t) =>
      `${uncovered(t)} transaction${uncovered(t) > 1 ? "s" : ""} unexplained — nothing suspicious, one document or answer would close it.`,
  },
  {
    key: "mule",
    label: "ESCALATE — mule-shaped flow",
    pred: (t) => t.verdict === "ESCALATE" && distinctCp(t) >= 8,
    score: (t) => [
      hasFlip(t) ? 1 : 0,
      MULE_CODES.has(t.reason_code) ? 1 : 0,
      Math.min(distinctCp(t), 30), // prefer the busiest flows, capped for readability
      uncovered(t),
    ],
    blurb: (t) =>
      `${distinctCp(t)} counterparties move £${Math.round(totalFlagged(t)).toLocaleString("en-GB")} through one account — ${t.reason_code.replace(/^ESC_/, "").toLowerCase().replaceAll("_", " ")}.`,
  },
  {
    key: "held_fx",
    label: "HELD PAYMENT — release or freeze",
    pred: (t) =>
      t.institution === "payments_fx" &&
      !!t.customer?.held_payment_id &&
      t.coverage.some((c) => c.transaction_id === t.customer.held_payment_id),
    score: (t) => [
      t.verdict === "CLOSE" ? 1 : 0, // a released payment tells the held-payment story best
      hasFlip(t) ? 1 : 0,
      t.coverage.length <= 8 ? 1 : 0,
      totalFlagged(t) / 1e6, // mild preference for a meaty payment
    ],
    blurb: (t) => {
      const row = t.coverage.find((c) => c.transaction_id === t.customer.held_payment_id);
      const amt = row ? `£${Math.round(row.amount_gbp).toLocaleString("en-GB")}` : "payment";
      return t.verdict === "CLOSE"
        ? `${amt} held by an alert — the evidence checks out, so it is released.`
        : `${amt} held by an alert — it stays frozen until the case resolves.`;
    },
  },
  {
    key: "tm22",
    label: "INTERNAL LIST — name on TM22",
    pred: (t) => t.alerts.some((a) => a.rule_id === "TM22"),
    score: (t) => [
      hasFlip(t) ? 1 : 0,
      t.verdict === "ESCALATE" ? 2 : t.verdict === "CLOSE" ? 1 : 0, // a confirmed listed party is the sharpest story
      -Math.abs(4 - t.coverage.length),
    ],
    blurb: (t) =>
      t.verdict === "ESCALATE"
        ? "A counterparty is the listed party — the case goes to the MLRO."
        : t.verdict === "CLOSE"
          ? "The name matched the internal list; the evidence shows a different party."
          : "A list match nothing on file settles either way — ask the customer.",
  },
];

const traces = [];
for (const inst of INSTITUTIONS) {
  const p = join(DATA_DIR, `${inst}.json`);
  if (!existsSync(p)) {
    console.error(`missing ${p} — run scripts/import-traces.mjs first`);
    process.exit(1);
  }
  traces.push(...JSON.parse(readFileSync(p, "utf8")));
}

const better = (a, b, score) => {
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return sb[i] - sa[i];
  }
  return a.case_id < b.case_id ? -1 : a.case_id > b.case_id ? 1 : 0;
};

const used = new Set();
const picks = [];
for (const slot of SLOTS) {
  const cands = traces.filter((t) => slot.pred(t) && !used.has(t.case_id));
  cands.sort((a, b) => better(a, b, slot.score));
  const pick = cands[0];
  if (!pick) {
    console.warn(`no candidate for ${slot.key}`);
    continue;
  }
  used.add(pick.case_id);
  picks.push({
    slot: slot.key,
    label: slot.label,
    blurb: slot.blurb(pick),
    institution: pick.institution,
    case_id: pick.case_id,
    verdict: pick.verdict,
    reason_code: pick.reason_code,
    customer_name: pick.customer?.name ?? "",
    flagged_gbp: Math.round(totalFlagged(pick) * 100) / 100,
    txns: pick.coverage.length,
    counterparties: distinctCp(pick),
    unexplained: uncovered(pick),
    has_flip: hasFlip(pick),
  });
  console.log(`${slot.key.padEnd(14)} → ${pick.case_id} (${pick.institution}, ${pick.verdict}, ${pick.coverage.length} txns, ${distinctCp(pick)} cps${pick.flip ? ", flip" : ""})`);
}

writeFileSync(
  join(DATA_DIR, "demo.json"),
  JSON.stringify({ generated_at: new Date().toISOString(), picks }, null, 1)
);
console.log(`demo.json: ${picks.length} picks`);
