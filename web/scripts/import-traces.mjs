#!/usr/bin/env node
/**
 * import-traces.mjs — build web/public/data/*.json for the demo UI.
 *
 * Real mode:  if ../output/traces/<institution>.jsonl exists, the lines are
 *             copied straight through (SHARED TRACE CONTRACT shape).
 * Fixture mode: otherwise, ~12 cases are picked from ../institutions/* and a
 *             plausible trace is derived from the REAL case data (alerts,
 *             transactions, evidence docs). Fixture output is marked so the
 *             UI can show a "FIXTURE DATA" badge.
 *
 * Usage: node scripts/import-traces.mjs   (run from web/)
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "..");
const TRACES_DIR = join(ROOT, "output", "traces");
const INST_DIR = join(ROOT, "institutions");
const OUT_DIR = join(WEB, "public", "data");

const INSTITUTIONS = ["bank", "emoney", "investment", "payments_fx"];
const CASES_PER_INSTITUTION = 3;

const HIGHER_RISK = new Set([
  "Afghanistan", "Belarus", "Democratic Republic of the Congo", "Haiti",
  "Iran", "Iraq", "Lebanon", "Libya", "Mali", "Myanmar", "North Korea",
  "Russia", "Somalia", "South Sudan", "Syria", "Venezuela", "Yemen",
]);

const DOC_TYPE_REASON = {
  invoice: "INVOICE_MATCHES",
  supplier_invoice: "INVOICE_MATCHES",
  supplier_invoices: "INVOICE_MATCHES",
  carrier_invoice: "INVOICE_MATCHES",
  dealer_invoice: "INVOICE_MATCHES",
  hospital_invoice: "INVOICE_MATCHES",
  freight_invoices: "INVOICE_MATCHES",
  purchase_order: "INVOICE_MATCHES",
  payment_file: "INVOICE_MATCHES",
  remittance_advice: "INVOICE_MATCHES",
  contract_schedule: "INVOICE_MATCHES",
  consulting_contract: "INVOICE_MATCHES",
  supply_contract: "INVOICE_MATCHES",
  factoring_agreement: "INVOICE_MATCHES",
  management_accounts: "BUSINESS_RECORDS_RECONCILE",
  takings_book: "BUSINESS_RECORDS_RECONCILE",
  cash_collection_reports: "COLLECTION_DOCUMENTED",
  cash_reconciliation: "BUSINESS_RECORDS_RECONCILE",
  bank_statement: "OWN_ACCOUNT",
  completion_statement: "DOCUMENTED_EVENT",
  vehicle_sale_receipt: "DOCUMENTED_EVENT",
  sale_receipt: "DOCUMENTED_EVENT",
  settlement_letter: "DOCUMENTED_EVENT",
  insurer_letter: "DOCUMENTED_EVENT",
  redundancy_letter: "DOCUMENTED_EVENT",
  solicitor_letter: "DOCUMENTED_EVENT",
  gift_letter: "DOCUMENTED_EVENT",
  loan_agreement: "THIRD_PARTY_DOCUMENTED",
  employment_contract: "WITHIN_PROFILE",
  deposit_return_letter: "REFUND_OF_EARLIER_PAYMENT",
  credit_note: "REFUND_OF_EARLIER_PAYMENT",
  cancellation_confirmation: "REFUND_OF_EARLIER_PAYMENT",
  reverification_record: "RETURNING_CUSTOMER",
  company_register_extract: "GROUP_COMPANY",
  group_structure: "GROUP_COMPANY",
  significant_control_register: "GROUP_COMPANY",
  booking_confirmation: "DOCUMENTED_EVENT",
  holding_deposit_receipt: "DOCUMENTED_EVENT",
  insurance_schedule: "DOCUMENTED_EVENT",
  advert: "DOCUMENTED_EVENT",
  ticket_report: "BUSINESS_RECORDS_RECONCILE",
  due_diligence_summary: "THIRD_PARTY_DOCUMENTED",
  customer_letter: "THIRD_PARTY_DOCUMENTED",
  customer_email: "THIRD_PARTY_DOCUMENTED",
  email: "THIRD_PARTY_DOCUMENTED",
  venue_email: "DOCUMENTED_EVENT",
};

const CHANNEL_LABEL = {
  cash_deposit: "Cash deposit",
  cash_topup: "Cash top-up",
  cash_withdrawal: "Cash withdrawal",
  card: "Card spend",
  wallet_transfer: "Wallet transfer",
  fund_subscription: "Fund purchase",
  fund_redemption: "Fund redemption",
  bacs: "Bacs transfer",
  faster_payment: "Bank transfer",
  swift: "SWIFT payment",
  standing_order: "Standing order",
  direct_debit: "Direct debit",
};

const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const readJsonl = (p) =>
  readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const gbp = (n) => `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ------------------------------ real traces ------------------------------ */

function realTraces() {
  if (!existsSync(TRACES_DIR)) return null;
  const files = readdirSync(TRACES_DIR).filter((f) => f.endsWith(".jsonl"));
  if (!files.length) return null;
  const byInst = {};
  for (const f of files) {
    const inst = f.replace(/\.jsonl$/, "");
    byInst[inst] = readJsonl(join(TRACES_DIR, f));
  }
  return byInst;
}

/* ------------------------------ fixture mode ----------------------------- */

function loadInstitution(inst) {
  const dir = join(INST_DIR, inst);
  const txnsByCustomer = new Map();
  for (const t of readJsonl(join(dir, "transactions.jsonl"))) {
    if (!txnsByCustomer.has(t.customer_id)) txnsByCustomer.set(t.customer_id, []);
    txnsByCustomer.get(t.customer_id).push(t);
  }
  const alertsById = new Map(readJsonl(join(dir, "alerts.jsonl")).map((a) => [a.alert_id, a]));
  const customersById = new Map(readJsonl(join(dir, "customers.jsonl")).map((c) => [c.customer_id, c]));
  const evByCustomer = new Map();
  for (const e of readJsonl(join(dir, "evidence.jsonl"))) {
    if (!evByCustomer.has(e.customer_id)) evByCustomer.set(e.customer_id, []);
    evByCustomer.get(e.customer_id).push(e);
  }
  const list = existsSync(join(dir, "internal_list.jsonl"))
    ? readJsonl(join(dir, "internal_list.jsonl"))
    : [];
  return { dir, cases: readJsonl(join(dir, "cases.jsonl")), txnsByCustomer, alertsById, customersById, evByCustomer, list };
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function docText(instDir, doc) {
  try {
    return readFileSync(join(instDir, doc.file), "utf8");
  } catch {
    return "";
  }
}

/** Does a doc mention this counterparty or this amount? Fixture heuristic. */
function docExplains(text, txn, customer) {
  const cp = norm(txn.counterparty_name);
  const amountStrs = [
    txn.amount_gbp.toFixed(2),
    txn.amount_gbp.toLocaleString("en-GB", { minimumFractionDigits: 2 }),
    txn.amount_gbp.toLocaleString("en-GB", { maximumFractionDigits: 0 }),
    String(Math.round(txn.amount_gbp)),
  ];
  const t = text.toLowerCase();
  if (cp && cp.length > 3 && norm(t).includes(cp)) return true;
  if (amountStrs.some((a) => a.length >= 4 && t.includes(a))) return true;
  // own-account: doc mentions the customer's own name
  if (norm(txn.counterparty_name) === norm(customer.name) && norm(t).includes(norm(customer.name))) return true;
  return false;
}

function pickCases(data) {
  // deterministically scan all cases; bucket by heuristic verdict; then pick a mix
  const scored = { CLOSE: [], RFI: [], ESCALATE: [] };
  for (const c of data.cases) {
    const alerts = c.alert_ids.map((id) => data.alertsById.get(id)).filter(Boolean);
    if (!alerts.length || alerts.length > 3) continue;
    const txIds = [...new Set(alerts.flatMap((a) => a.transaction_ids))];
    if (txIds.length < 2 || txIds.length > 14) continue;
    const txns = (data.txnsByCustomer.get(c.customer_id) || []).filter((t) => txIds.includes(t.transaction_id));
    if (txns.length < 2) continue;
    const customer = data.customersById.get(c.customer_id);
    if (!customer) continue;
    const docs = data.evByCustomer.get(c.customer_id) || [];
    const docCache = docs.map((d) => ({ d, text: docText(data.dir, d) }));
    const cov = txns.map((t) => docCache.find(({ text }) => docExplains(text, t, customer))?.d || null);
    const covered = cov.filter(Boolean).length;
    const risky = txns.some((t) => HIGHER_RISK.has(t.counterparty_country));
    const onList = txns.some((t) =>
      data.list.some((e) => norm(e.name) === norm(t.counterparty_name))
    );
    let verdict;
    if (covered === txns.length && covered > 0) verdict = "CLOSE";
    else if (risky || onList) verdict = "ESCALATE";
    else verdict = "RFI";
    scored[verdict].push({ c, alerts, txns, customer, docCache, cov, risky, onList });
  }
  // pick spread: prefer one of each verdict, then fill remaining slots
  const picks = [];
  for (const v of ["CLOSE", "RFI", "ESCALATE"]) {
    if (scored[v].length) picks.push(scored[v][Math.floor(scored[v].length / 2)]);
  }
  for (const v of ["RFI", "CLOSE", "ESCALATE"]) {
    if (picks.length >= CASES_PER_INSTITUTION) break;
    const cand = scored[v].find((s) => !picks.includes(s));
    if (cand) picks.push(cand);
  }
  return picks.slice(0, CASES_PER_INSTITUTION);
}

function riskContext(txns, customer, alerts) {
  const rc = [];
  if (txns.some((t) => t.amount_gbp % 500 === 0 && t.amount_gbp >= 2000)) rc.push("round amounts");
  if (txns.some((t) => HIGHER_RISK.has(t.counterparty_country))) rc.push("higher-risk corridor");
  if (txns.some((t) => t.counterparty_name && norm(t.counterparty_name) !== norm(customer.name) && t.direction === "in" && customer.kind === "individual" && !/ltd|limited|plc|llp/i.test(t.counterparty_name || ""))) rc.push("third-party payer");
  if (/crypto|bitcoin|btc|binance|coinbase|kraken/i.test(txns.map((t) => t.counterparty_name).join(" "))) rc.push("crypto counterparty");
  if (/casino|bet|gambl|poker|lottery/i.test(txns.map((t) => t.counterparty_name).join(" "))) rc.push("gambling counterparty");
  if (alerts.some((a) => a.rule_id === "TM07")) rc.push("dormant reactivation");
  if (alerts.some((a) => a.rule_id === "TM02")) rc.push("rapid in-and-out");
  const under = txns.filter((t) => t.amount_gbp >= 9000 && t.amount_gbp < 10000);
  if (under.length >= 2) rc.push("amounts just under £10k");
  return [...new Set(rc)];
}

function buildTrace(inst, pick, idx) {
  const { c, alerts, txns, customer, docCache, cov, risky, onList } = pick;
  const coverage = txns.map((t, i) => {
    const doc = cov[i];
    return {
      transaction_id: t.transaction_id,
      amount_gbp: t.amount_gbp,
      direction: t.direction,
      counterparty:
        t.counterparty_name ?? CHANNEL_LABEL[t.channel] ?? t.channel ?? "Unknown",
      country: t.counterparty_country,
      booked_at: t.booked_at,
      covered_by: doc ? doc.doc_id : null,
      why: doc
        ? `${doc.title.replace(/\.$/, "")} (${doc.doc_id}) supports this payment`
        : `no document on file explains this ${t.direction === "in" ? "receipt" : "payment"}`,
    };
  });
  const coveredDocs = cov.filter(Boolean);
  const uncovered = coverage.filter((x) => !x.covered_by);
  const allCovered = uncovered.length === 0;
  const total = txns.reduce((s, t) => s + t.amount_gbp, 0);
  const rules = [...new Set(alerts.map((a) => a.rule_id))];

  let verdict, reason_code, reason;
  if (allCovered) {
    verdict = "CLOSE";
    const types = coveredDocs.map((d) => d.type);
    reason_code =
      (rules.includes("TM22") && "LIST_MATCH_DIFFERENT_PARTY") ||
      DOC_TYPE_REASON[types[0]] ||
      "WITHIN_PROFILE";
    const uniqDocs = [...new Map(coveredDocs.map((d) => [d.doc_id, d])).values()];
    reason = `Every alerted transaction is explained by documents on file. ${uniqDocs
      .slice(0, 3)
      .map((d) => `${d.doc_id} (${d.title})`)
      .join("; ")} reconcile to the ${gbp(total)} of flagged activity for ${customer.name}.`;
  } else if (risky || onList) {
    verdict = "ESCALATE";
    const bad = coverage.find((x) => !x.covered_by) || coverage[0];
    if (onList) {
      reason_code = "ESC_LISTED_PARTY";
      reason = `A counterparty matches an entry on the internal list and nothing on file shows it is a different party. ${gbp(bad.amount_gbp)} moved to or from ${bad.counterparty} with no supporting document. The case goes to the MLRO.`;
    } else {
      reason_code = "ESC_HIGH_RISK_CORRIDOR";
      reason = `Unexplained ${bad.direction === "in" ? "funds from" : "payments to"} ${bad.country}, a higher-risk corridor the customer did not declare. ${gbp(bad.amount_gbp)} to ${bad.counterparty} has no credible explanation on file. Escalated to the MLRO.`;
    }
  } else {
    verdict = "RFI";
    const rule = rules[0];
    reason_code =
      { TM01: "RFI_SOURCE_OF_FUNDS", TM02: "RFI_PURPOSE_DOCUMENTS", TM03: "RFI_BUSINESS_RECORDS",
        TM04: "RFI_COUNTERPARTY_DETAILS", TM05: "RFI_SOURCE_OF_FUNDS", TM06: "RFI_COUNTERPARTY_DETAILS",
        TM07: "RFI_SOURCE_OF_FUNDS", TM08: "RFI_COUNTERPARTY_DETAILS", TM10: "RFI_PURPOSE_DOCUMENTS",
        TM22: "RFI_COUNTERPARTY_DETAILS" }[rule] || "RFI_PURPOSE_DOCUMENTS";
    const bad = uncovered[0];
    reason = `Nothing on file explains ${gbp(bad.amount_gbp)} ${bad.direction === "in" ? "from" : "to"} ${bad.counterparty}, and nothing else suggests crime. Ask the customer for documents showing what the payment was for — for example an invoice or agreement naming ${bad.counterparty}.`;
  }

  const steps = [];
  steps.push({
    step: 1,
    policy_clause: "one case gets one verdict, even when several rules fired",
    question: `Scope the case: ${alerts.length} alert${alerts.length > 1 ? "s" : ""} (${rules.join(", ")}) fired on ${txns.length} transaction${txns.length > 1 ? "s" : ""} totalling ${gbp(total)}.`,
    result: "PASS",
    evidence: alerts.map((a) => a.alert_id),
  });
  const declared = customer.declared?.monthly_income_gbp ?? (customer.declared?.annual_turnover_gbp ? Math.round(customer.declared.annual_turnover_gbp / 12) : null);
  steps.push({
    step: 2,
    policy_clause: "money received over 30 days vs the declared profile",
    question: declared
      ? `Compare activity with the declared profile (${gbp(declared)}/month declared): does the volume need a profile update?`
      : "Compare activity with the declared profile.",
    result: rules.includes("TM01") ? (verdict === "ESCALATE" ? "FAIL" : "UNKNOWN") : "PASS",
    evidence: [],
  });
  steps.push({
    step: 3,
    policy_clause: "close only when the evidence explains the activity",
    question: "Does a document on file explain every transaction the alerts fired on?",
    result: allCovered ? "PASS" : verdict === "RFI" ? "UNKNOWN" : "FAIL",
    evidence: [...new Set(coveredDocs.map((d) => d.doc_id))],
  });
  if (rules.includes("TM22") || onList) {
    steps.push({
      step: steps.length + 1,
      policy_clause: "a match on one detail alone does not prove it is the same party",
      question: "Does the counterparty match an internal-list entry, and is it the same party?",
      result: onList ? "FAIL" : "UNKNOWN",
      evidence: [],
    });
  }
  steps.push({
    step: steps.length + 1,
    policy_clause: "once there is suspicion, escalate rather than ask the customer",
    question:
      verdict === "ESCALATE"
        ? "Is there suspicion of crime? If so the case goes to the MLRO without asking the customer."
        : "Is there any sign of crime, or is one document or answer enough to settle the case?",
    result: verdict === "ESCALATE" ? "FAIL" : "PASS",
    evidence: [],
  });
  steps.forEach((s, i) => (s.step = i + 1));

  let flip = null;
  if (verdict === "CLOSE" && coveredDocs[0]) {
    flip = {
      change: `If ${coveredDocs[0].doc_id} were not on file, the flagged activity would have no documented explanation`,
      new_verdict: "RFI",
    };
  } else if (verdict === "RFI") {
    flip = {
      change: `If the customer provides a document naming ${uncovered[0].counterparty} for ${gbp(uncovered[0].amount_gbp)}`,
      new_verdict: "CLOSE",
    };
  } else if (onList) {
    flip = {
      change: "If evidence showed the counterparty is a different party from the listed entry",
      new_verdict: "CLOSE",
    };
  }

  return {
    case_id: c.case_id,
    institution: inst,
    customer: {
      id: customer.customer_id,
      name: customer.name,
      kind: customer.kind,
      occupation_or_activity: customer.occupation || customer.business_activity || null,
      declared_monthly_gbp: declared,
      expected_countries: customer.declared?.expected_countries || [],
      // extra display-only fields (UI tolerates their absence)
      risk_rating: customer.risk_rating,
      address: customer.address,
      onboarded_on: customer.onboarded_on,
      account_purpose: customer.declared?.account_purpose || null,
      source_of_funds: customer.declared?.source_of_funds || null,
      expected_channels: customer.declared?.expected_channels || [],
      held_payment_id: c.held_payment_id || null,
      review_window: c.review_window,
    },
    verdict,
    reason_code,
    reason,
    evidence: [...new Set([...coveredDocs.map((d) => d.doc_id), ...txns.slice(0, 3).map((t) => t.transaction_id)])],
    alerts: alerts.map((a) => ({
      alert_id: a.alert_id,
      rule_id: a.rule_id,
      rule_name: a.rule_name,
      message: a.message,
      transaction_ids: a.transaction_ids,
    })),
    coverage,
    checks: steps,
    flip,
    risk_context: riskContext(txns, customer, alerts),
    engine_version: "fixture-1.0.0",
    input_hash: hash(c.case_id + alerts.map((a) => a.alert_id).join(",")),
  };
}

function buildFixtures() {
  const out = {};
  for (const inst of INSTITUTIONS) {
    const dir = join(INST_DIR, inst);
    if (!existsSync(dir)) continue;
    const data = loadInstitution(inst);
    const picks = pickCases(data);
    out[inst] = picks.map((p, i) => buildTrace(inst, p, i));
  }
  return out;
}

/* --------------------------------- main ---------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });
// clear stale per-institution files
for (const f of readdirSync(OUT_DIR)) {
  if (f.endsWith(".json")) rmSync(join(OUT_DIR, f));
}

const real = realTraces();
const fixture = !real;
const data = real || buildFixtures();

const institutions = [];
for (const [inst, traces] of Object.entries(data)) {
  writeFileSync(join(OUT_DIR, `${inst}.json`), JSON.stringify(traces, null, 1));
  institutions.push({ id: inst, cases: traces.length });
}

const reproSrc = join(ROOT, "output", "repro.json");
let repro = false;
if (!fixture && existsSync(reproSrc)) {
  copyFileSync(reproSrc, join(OUT_DIR, "repro.json"));
  repro = true;
} else if (fixture) {
  writeFileSync(
    join(OUT_DIR, "repro.json"),
    JSON.stringify({
      fixture: true,
      runs: 5,
      identical_verdicts: true,
      identical_reason_codes: true,
      note: "EXAMPLE DATA — placeholder shown until the engine produces real run results",
    })
  );
  repro = true;
}

writeFileSync(
  join(OUT_DIR, "manifest.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      fixture,
      institutions,
      repro,
      total_cases: institutions.reduce((s, i) => s + i.cases, 0),
    },
    null,
    1
  )
);

console.log(
  `${fixture ? "FIXTURE" : "REAL"} import: ${institutions.map((i) => `${i.id}=${i.cases}`).join(", ")} → ${OUT_DIR}`
);
