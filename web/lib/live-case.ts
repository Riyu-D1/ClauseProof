// Turns a LiveScenario into a synthetic institution folder in the EXACT
// dataset format, and fires alerts by honestly applying that institution's
// documented TM thresholds to the generated transactions — same job as
// play-case.ts does for the game, but for arbitrary user-described cases.
// The verdict is never computed here: that is always the engine's.

import type { Alert, DocMeta, Txn } from "./play-case.ts";
import type { InstitutionId } from "./play.ts";
import {
  HIGH_RISK_SET,
  OWN_ACCT_NO,
  PAYEE_ACCT_NO,
  type LiveDoc,
  type LivePayment,
  type LiveScenario,
} from "./live-scenario.ts";

/* --------------------------------- shape --------------------------------- */

export interface LiveCase {
  institution: InstitutionId;
  files: Record<string, string>;
  caseId: string;
  alertIds: string[];
  heldPaymentId: string | null;
  txns: Txn[];
  alerts: Alert[];
  context: string[];
  docTexts: Record<string, string>; // doc_id -> markdown (for the UI drawer)
  custName: string;
  custKind: string;
  /** payment.id -> transaction_id */
  txnIdByPaymentId: Map<string, string>;
}

export const CUST_ID = "LIVE-C001";
const ACCT_ID = "LIVE-A001";
const CASE_ID = "LIVE-CS0001";
const WINDOW = { from: "2026-10-01", to: "2026-10-31" };
const OPENED_AT = "2026-11-02T06:00:00Z";
const ALERT_AT = "2026-11-01T06:00:00Z";
export const LIST_ENTRY_DOB = "1974-09-11"; // fixed for the synthetic list entry
const GIFT_DOB_DIFFERENT = "1988-11-03"; // gift-letter DoB that clears a match

const RULE_NAMES: Record<string, string> = {
  TM01: "Activity exceeds the expected profile",
  TM02: "Rapid movement of funds",
  TM03: "Repeated transactions below a threshold",
  TM04: "Many-to-one or one-to-many payments",
  TM05: "Large or unexpected cash activity",
  TM06: "Unexpected higher-risk corridor",
  TM07: "Dormant account reactivation",
  TM08: "Third-party funding or payout",
  TM10: "Unusually early fund redemption",
  TM22: "Counterparty on an internal list",
};

const g2 = (n: number) => Math.round(n * 100) / 100;
const GBP = (n: number) =>
  `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const dtext = (d: Date) =>
  `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const pad = (n: number) => String(n).padStart(2, "0");
const dayIso = (day: number, hour: number) => {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `2026-10-${pad(Math.max(1, Math.min(30, day)))}T${pad(h)}:${pad(m % 60)}:00Z`;
};

const CASH_SPOTS = [
  "Ridgeway Convenience Store", "Halgate High Street branch",
  "Draymere News & Booze", "Collins Parade Post Office",
];

/* ------------------------------ transactions ----------------------------- */

function channelFor(inst: InstitutionId, p: LivePayment): string {
  const foreign = p.country !== "United Kingdom";
  if (p.direction === "in") {
    switch (p.channel) {
      case "cash": return inst === "emoney" ? "cash_topup" : "cash_deposit";
      case "fund_sell": return "fund_redemption";
      case "card": return "faster_payment";
      default: return foreign ? "swift" : "faster_payment";
    }
  }
  switch (p.channel) {
    case "cash": return "cash_withdrawal";
    case "card": return "card";
    case "fund_buy": return "fund_subscription";
    case "fund_sell": return "fund_redemption";
    case "crypto": return "faster_payment";
    default:
      if (inst === "emoney") return "wallet_transfer";
      if (inst === "payments_fx") return foreign ? "swift" : "faster_payment";
      return foreign ? "swift" : "faster_payment";
  }
}

function buildTxns(
  s: LiveScenario, custName: string
): { txns: Txn[]; txnIdByPaymentId: Map<string, string> } {
  const sorted = [...s.payments].sort(
    (a, b) => a.day - b.day || a.hour - b.hour || (a.direction === "in" ? -1 : 1)
  );
  const txnIdByPaymentId = new Map<string, string>();
  const txns = sorted.map((p, i) => {
    const tid = `LIVE-T${String(i + 1).padStart(3, "0")}`;
    txnIdByPaymentId.set(p.id, tid);
    const ch = channelFor(s.institution, p);
    const own = p.ownAccount;
    const cpName = p.counterparty == null ? null : own ? custName : p.counterparty;
    const cpAcct =
      cpName == null ? null : own ? OWN_ACCT_NO : PAYEE_ACCT_NO;
    const ref =
      p.reference ??
      (ch.startsWith("cash") ? ch.replace(/_/g, " ").toUpperCase()
       : ch === "fund_subscription" ? "FUND BUY"
       : ch === "fund_redemption" ? "FUND SELL"
       : s.institution === "investment" ? (p.direction === "in" ? "DEPOSIT" : "WITHDRAWAL")
       : s.institution === "payments_fx" ? (p.direction === "in" ? "FUNDS IN" : "SUPPLIER PAYMENT")
       : p.direction === "in" ? "TRANSFER" : "PAYMENT");
    return {
      transaction_id: `LIVE-T${String(i + 1).padStart(3, "0")}`,
      customer_id: CUST_ID,
      account_id: ACCT_ID,
      booked_at: dayIso(p.day, p.hour),
      direction: p.direction,
      channel: ch,
      amount_gbp: g2(p.amountGbp),
      counterparty_name: cpName,
      counterparty_account: cpAcct,
      counterparty_country: p.country,
      reference: ref,
      location: p.channel === "cash" ? CASH_SPOTS[i % CASH_SPOTS.length] : null,
      currency: "GBP",
      amount: g2(p.amountGbp),
    };
  });
  return { txns, txnIdByPaymentId };
}

/* --------------------------------- alerts -------------------------------- */

const IN_FUNDING = new Set([
  "faster_payment", "swift", "bacs", "wallet_transfer",
  "cash_deposit", "cash_topup",
]);
const TRANSFER_CH = new Set(["faster_payment", "swift", "bacs", "wallet_transfer"]);
const CASH_IN = new Set(["cash_deposit", "cash_topup"]);

interface FiredAlert {
  rule_id: string;
  message: string;
  measured: Record<string, unknown>;
  transaction_ids: string[];
}

function isCompany(n: string): boolean {
  return /\b(ltd|limited|llc|plc|inc|corp|gmbh|s\.a\.|llp|partners|holdings|group|trading|services|supplies|foods|studio|solicitors)\b/i.test(n);
}

function fireLiveAlerts(s: LiveScenario, txns: Txn[]): FiredAlert[] {
  const inst = s.institution;
  const fired: FiredAlert[] = [];
  const custName = s.customerName;
  const baseline = s.monthlyGbp;
  const declaredCountries = s.expectedCountries;

  const deposits = txns.filter(
    (t) => t.direction === "in" && IN_FUNDING.has(t.channel)
  );
  const outs = txns.filter((t) => t.direction === "out");
  const received = g2(deposits.reduce((s2, t) => s2 + t.amount_gbp, 0));

  // TM01 — inflows vs declared profile (30 days)
  const multLimit = s.customerKind === "business" ? 2 : 3;
  if (baseline > 0 && received > multLimit * baseline) {
    const multiple = Math.round((received / baseline) * 100) / 100;
    const basis =
      s.customerKind === "business"
        ? "declared monthly turnover"
        : "declared monthly income";
    fired.push({
      rule_id: "TM01",
      message: `In the 30 days to ${WINDOW.to}, the account received ${GBP(received)}, ${multiple} times the ${basis} of ${GBP(baseline)}. The limit is ${multLimit} times.`,
      measured: {
        received_gbp: received, baseline_gbp: baseline, multiple,
        limit_multiple: multLimit, window_days: 30,
      },
      transaction_ids: deposits.map((t) => t.transaction_id),
    });
  }

  // TM02 — rapid movement
  if (received >= 2000) {
    let depCount = deposits;
    if (inst === "payments_fx") {
      depCount = deposits.filter(
        (t) => t.counterparty_name && t.counterparty_name !== custName
      );
    }
    const fxReceived = depCount.reduce((s2, t) => s2 + t.amount_gbp, 0);
    const ownOnly = inst === "payments_fx" && fxReceived < 2000;
    if (!ownOnly) {
      const withinH = inst === "investment" ? 240 : 48;
      const invested = outs
        .filter((t) => t.channel === "fund_subscription")
        .reduce((s2, t) => s2 + t.amount_gbp, 0);
      const pays = outs.filter(
        (t) => t.channel !== "fund_subscription" && t.channel !== "card"
      );
      let paidFast = 0;
      let pool = pays.reduce((s2, t) => s2 + t.amount_gbp, 0);
      const hitIns: string[] = [];
      for (const d of depCount) {
        const arrive = Date.parse(d.booked_at);
        const outAt = pays
          .map((t) => Date.parse(t.booked_at))
          .filter((x) => x >= arrive)
          .sort((a, b) => a - b)[0];
        if (pool <= 0 || outAt === undefined) break;
        if ((outAt - arrive) / 3600_000 <= withinH) {
          paidFast += Math.min(d.amount_gbp, pool);
          hitIns.push(d.transaction_id);
        }
        pool -= d.amount_gbp;
      }
      paidFast = Math.min(paidFast, fxReceived);
      const share = fxReceived > 0 ? paidFast / fxReceived : 0;
      const investedShare = received > 0 ? invested / received : 0;
      const fires =
        inst === "investment"
          ? share >= 0.8 && investedShare < 0.2
          : share >= 0.8;
      if (fires && pays.length) {
        const span = inst === "investment" ? "10 days" : "48 hours";
        fired.push({
          rule_id: "TM02",
          message: `In the 10 days to ${WINDOW.to}, ${GBP(fxReceived)} was received and ${GBP(g2(paidFast))} left again within ${span} (${Math.round(share * 100)}%). The limit is 80% of money received.`,
          measured: {
            received_gbp: g2(fxReceived), paid_out_gbp: g2(paidFast),
            share: Math.round(share * 100) / 100, invested_gbp: g2(invested),
            limit_share: 0.8, window_days: 10,
          },
          transaction_ids: [...hitIns, ...pays.map((t) => t.transaction_id)],
        });
      }
    }
  }

  // TM03 — just under the threshold
  if (inst === "bank" || inst === "emoney") {
    const lo = inst === "emoney" ? 800 : 9000;
    const hi = inst === "emoney" ? 999.99 : 9999.99;
    const limit = inst === "emoney" ? 4 : 3;
    const cashy = deposits.filter(
      (t) => CASH_IN.has(t.channel) && t.amount_gbp >= lo && t.amount_gbp <= hi
    );
    // must sit within a 10-day span
    const days = cashy.map((t) => Date.parse(t.booked_at) / 86400_000);
    const in10 = days.length ? Math.max(...days) - Math.min(...days) <= 10 : false;
    if (cashy.length >= limit && in10) {
      const tot = cashy.reduce((s2, t) => s2 + t.amount_gbp, 0);
      const what = inst === "emoney" ? "cash top-ups" : "cash deposits";
      fired.push({
        rule_id: "TM03",
        message: `In the 10 days to ${WINDOW.to}, ${cashy.length} ${what} each sat between ${GBP(lo)} and ${GBP(hi)}. The limit is ${limit - 1}.`,
        measured: {
          count: cashy.length, total_gbp: g2(tot),
          locations: new Set(cashy.map((t) => t.location).filter(Boolean)).size || 1,
          limit_count: limit - 1, window_days: 10,
        },
        transaction_ids: cashy.map((t) => t.transaction_id),
      });
    }
  }
  if (inst === "payments_fx") {
    const byBene = new Map<string, Txn[]>();
    for (const t of outs) {
      if (!t.counterparty_name) continue;
      byBene.set(t.counterparty_name, [...(byBene.get(t.counterparty_name) ?? []), t]);
    }
    for (const [bene, list] of byBene) {
      const inBand = list.filter(
        (t) => t.amount_gbp >= 9000 && t.amount_gbp <= 9999.99
      );
      const days = inBand.map((t) => Date.parse(t.booked_at) / 86400_000);
      const in10 = days.length ? Math.max(...days) - Math.min(...days) <= 10 : false;
      if (inBand.length >= 3 && in10) {
        fired.push({
          rule_id: "TM03",
          message: `In the 10 days to ${WINDOW.to}, ${inBand.length} payments to ${bene} each sat between £9,000.00 and £9,999.99. The limit is 2.`,
          measured: {
            payments: inBand.length, beneficiary: bene,
            total_gbp: g2(inBand.reduce((s2, t) => s2 + t.amount_gbp, 0)),
            limit_count: 2, window_days: 10,
          },
          transaction_ids: inBand.map((t) => t.transaction_id),
        });
      }
    }
  }

  // TM04 — many-to-one / one-to-many
  if (inst === "bank" || inst === "emoney") {
    const seen = new Map<string, Txn[]>();
    for (const t of txns) {
      if (!TRANSFER_CH.has(t.channel) || !t.counterparty_name) continue;
      if (t.counterparty_name === custName) continue;
      seen.set(t.counterparty_name, [...(seen.get(t.counterparty_name) ?? []), t]);
    }
    if (seen.size > 6) {
      const ids = [...seen.values()].flat().map((t) => t.transaction_id);
      const tot = txns
        .filter((t) => ids.includes(t.transaction_id) && t.direction === "in")
        .reduce((s2, t) => s2 + t.amount_gbp, 0);
      fired.push({
        rule_id: "TM04",
        message: `In the 30 days to ${WINDOW.to}, ${seen.size} different people or companies paid the account or were paid by it, more than the limit of 6. Together they moved ${GBP(g2(tot))}.`,
        measured: {
          direction: "incoming", distinct_counterparties: seen.size,
          limit: 6, total_gbp: g2(tot), window_days: 30,
        },
        transaction_ids: ids,
      });
    }
  }
  if (inst === "payments_fx") {
    const benes = new Set(
      outs
        .filter((t) => t.counterparty_name && t.counterparty_name !== custName)
        .map((t) => t.counterparty_name)
    );
    if (benes.size > 25) {
      const ids = outs
        .filter((t) => benes.has(t.counterparty_name!))
        .map((t) => t.transaction_id);
      fired.push({
        rule_id: "TM04",
        message: `In the 30 days to ${WINDOW.to}, the client paid ${benes.size} different beneficiaries, more than the limit of 25.`,
        measured: {
          direction: "outgoing", distinct_counterparties: benes.size,
          limit: 25,
          total_gbp: g2(outs.reduce((s2, t) => s2 + t.amount_gbp, 0)),
          window_days: 30,
        },
        transaction_ids: ids,
      });
    }
  }

  // TM05 — large cash
  if (inst === "bank" || inst === "emoney") {
    const limit =
      inst === "emoney"
        ? s.customerKind === "business" ? 5000 : 1000
        : s.customerKind === "business" ? 25000 : 10000;
    const cashChannels = inst === "emoney" ? ["cash_topup"] : ["cash_deposit", "cash_withdrawal"];
    for (const t of txns) {
      if (cashChannels.includes(t.channel) && t.amount_gbp >= limit) {
        const what =
          inst === "emoney" ? "cash top-up"
          : t.channel === "cash_withdrawal" ? "cash withdrawal" : "cash deposit";
        fired.push({
          rule_id: "TM05",
          message: `A ${what} of ${GBP(t.amount_gbp)} was made on ${dtext(new Date(t.booked_at))}. One ${what} of ${GBP(limit)} or more needs review.`,
          measured: { amount_gbp: t.amount_gbp, limit_gbp: limit },
          transaction_ids: [t.transaction_id],
        });
        break;
      }
    }
  }

  // TM06 — higher-risk corridor
  {
    const hr = txns.filter((t) => {
      const c = t.counterparty_country;
      return (
        c &&
        HIGH_RISK_SET.some((h) => h.toLowerCase() === c.toLowerCase()) &&
        !declaredCountries.some((d) => d.toLowerCase() === c.toLowerCase())
      );
    });
    const tot = g2(hr.reduce((s2, t) => s2 + t.amount_gbp, 0));
    if (tot >= 5000) {
      const countries = [...new Set(hr.map((t) => t.counterparty_country))].join(", ");
      fired.push({
        rule_id: "TM06",
        message: `In the 30 days to ${WINDOW.to}, ${GBP(tot)} moved to or from ${countries}, a higher-risk country the customer did not declare. The limit is £5,000.00.`,
        measured: { total_gbp: tot, countries, limit_gbp: 5000, window_days: 30 },
        transaction_ids: hr.map((t) => t.transaction_id),
      });
    }
  }

  // TM07 — dormant reactivation (scenario flag)
  if (s.dormant) {
    const moved = g2(txns.reduce((s2, t) => s2 + t.amount_gbp, 0));
    if (moved >= 5000) {
      fired.push({
        rule_id: "TM07",
        message: `The account had no activity for more than 180 days before this window. Since then ${GBP(moved)} has moved in and out. The limit is £5,000.00.`,
        measured: { dormant_days: 395, moved_gbp: moved, limit_gbp: 5000, limit_days: 180 },
        transaction_ids: txns.map((t) => t.transaction_id),
      });
    }
  }

  // TM08 — third-party funding / payout (payments_fx, investment)
  if (inst === "payments_fx" || inst === "investment") {
    const flows = txns.filter(
      (t) =>
        t.amount_gbp >= 1000 &&
        t.counterparty_name &&
        t.counterparty_name !== custName &&
        t.channel !== "fund_subscription" &&
        t.channel !== "fund_redemption" &&
        (inst === "payments_fx" ? t.direction === "in" : true)
    );
    if (flows.length) {
      const tot = flows.reduce((s2, t) => s2 + t.amount_gbp, 0);
      const f = flows[0];
      const dir = f.direction === "in" ? "into" : "out of";
      fired.push({
        rule_id: "TM08",
        message:
          inst === "payments_fx"
            ? `${flows.length} funding payment${flows.length > 1 ? "s" : ""} totalling ${GBP(g2(tot))} came from accounts not in the client's name. The limit is £1,000.00 per flow.`
            : `${f.counterparty_name} moved ${GBP(g2(tot))} ${dir} the account on ${dtext(new Date(f.booked_at))}. The account holder name does not match the customer, ${custName}.`,
        measured: { flows: flows.length, total_gbp: g2(tot), limit_gbp: 1000 },
        transaction_ids: flows.map((t) => t.transaction_id),
      });
    }
  }

  // TM10 — early fund redemption (investment)
  if (inst === "investment") {
    const buys = txns.filter((t) => t.channel === "fund_subscription");
    const sells = txns.filter((t) => t.channel === "fund_redemption");
    for (const b of buys) {
      for (const s2 of sells) {
        if (s2.counterparty_name !== b.counterparty_name) continue;
        const days = Math.round(
          (Date.parse(s2.booked_at) - Date.parse(b.booked_at)) / 86400_000
        );
        if (days >= 0 && days < 90) {
          fired.push({
            rule_id: "TM10",
            message: `Units in ${b.counterparty_name} bought on ${dtext(new Date(b.booked_at))} for ${GBP(b.amount_gbp)} were sold back on ${dtext(new Date(s2.booked_at))} for ${GBP(s2.amount_gbp)}, ${days} days later. The limit is 90 days.`,
            measured: {
              fund: b.counterparty_name, held_days: days,
              bought_gbp: b.amount_gbp, redeemed_gbp: s2.amount_gbp,
              limit_days: 90,
            },
            transaction_ids: [b.transaction_id, s2.transaction_id],
          });
        }
      }
    }
  }

  // TM22 — internal list hit (scenario flag)
  if (s.listHitCounterparty) {
    const cp = s.listHitCounterparty;
    const hit = txns.filter((t) => t.counterparty_name === cp);
    if (hit.length) {
      const company = isCompany(cp);
      const f = hit[0];
      fired.push({
        rule_id: "TM22",
        message:
          `The payment of ${GBP(f.amount_gbp)} ${f.direction === "in" ? "from" : "to"} ${cp} on ${dtext(new Date(f.booked_at))} matched internal list entry LIVE-L0001 on ${company ? "name" : "name and month and year of birth"}. Matched party: ${cp}.`,
        measured: {
          list_entry: "LIVE-L0001",
          matched_on: company ? "name" : "name and month and year of birth",
          matched_party: cp,
        },
        transaction_ids: hit.map((t) => t.transaction_id),
      });
    }
  }

  return fired;
}

/* --------------------------------- docs ---------------------------------- */

function docFor(d: LiveDoc, s: LiveScenario, txns: Txn[], txnIdByPaymentId: Map<string, string>, seq: number): { meta: DocMeta; text: string } | null {
  const cust = s.customerName;
  const docId = `DOC-${String(seq).padStart(3, "0")}`;
  const dated = "2026-09-28";
  const datedTxt = "28 September 2026";
  const linked = d.linkedPaymentId
    ? txns.find((t) => t.transaction_id === txnIdByPaymentId.get(d.linkedPaymentId!))
    : null;
  const amount = d.amountGbp ?? linked?.amount_gbp ?? null;
  const amt = amount != null
    ? (d.matching ? amount : g2(amount * 0.62))
    : null;
  const party = d.partyName ?? linked?.counterparty_name ?? null;

  const mk = (type: string, title: string, body: string) => ({
    meta: {
      doc_id: docId, customer_id: CUST_ID, type, title,
      dated, file: `evidence/${docId}.md`,
    },
    text: `# ${title}\n\n**Document ID:** ${docId}\n**Dated:** ${datedTxt}\n\n${body}\n`,
  });

  switch (d.type) {
    case "invoice":
      if (!party || amt == null) return null;
      return mk("invoice", `Invoice ${docId} from ${party}`,
        `**Bill to:** ${cust}\n**Description:** Goods and services supplied\n**Amount due:** ${GBP(amt)}\n**Pay to:** ${party}, account ${PAYEE_ACCT_NO}`);
    case "contract":
      if (!party) return null;
      return mk("supply_contract", `Supply contract with ${party}`,
        `**Supplier:** ${party}\n**Client:** ${cust}\n**Value:** ${amt != null ? GBP(amt) : "per schedule"}\n**Term:** 12 months`);
    case "receivable": {
      if (!party || amt == null) return null;
      return mk("supplier_invoices", `Invoices issued by ${cust}`,
        `| Invoice | Payer | Amount |\n|---|---|---|\n| ${docId}-1 | ${party} | ${GBP(amt)} |`);
    }
    case "employment":
      return mk("employment_contract", `Employment contract — ${cust}`,
        `**Employee:** ${cust}\n**Employer:** ${s.employer ?? "Marbrook Services Ltd"}\n**Salary:** ${GBP((s.monthlyGbp || 2500) * 12)} per year, paid monthly\n**Start:** 2 February 2024`);
    case "bank_statement":
      return mk("bank_statement", `Statement from Alderbeck Savings Bank`,
        `**Account holder:** ${cust}\n**Bank:** Alderbeck Savings Bank\n**Account:** ${OWN_ACCT_NO}\n\n${datedTxt}: transfers between accounts in ${cust}'s name.`);
    case "gift_letter": {
      if (!party || amt == null) return null;
      const dob = d.partyDob ?? GIFT_DOB_DIFFERENT;
      const [y, m, dd] = dob.split("-").map(Number);
      const dobTxt = `${dd} ${MONTHS[m - 1]} ${y}`;
      const rel = / (son|daughter)\b/i.test(cust) ? "niece" : "niece";
      return mk("gift_letter", `Gift letter from ${party}`,
        `I, ${party}, born ${dobTxt}, hereby give a gift of ${GBP(amt)} to my ${rel}, ${cust}. This is an unconditional gift and no repayment is expected.`);
    }
    case "loan_agreement":
      if (!party || amt == null) return null;
      return mk("loan_agreement", `Loan agreement — ${party} and ${cust}`,
        `**Borrower:** ${cust}\n**Lender:** ${party}\n**Principal amount:** ${GBP(amt)}\n**Repayment:** within 24 months`);
    case "cash_records": {
      const rows = txns
        .filter((t) => CASH_IN.has(t.channel))
        .map((t) => `| ${dtext(new Date(t.booked_at))} | ${GBP(t.amount_gbp)} |`)
        .join("\n");
      return mk("takings_book", `Takings book — ${cust}`,
        `| Date | Banked |\n|---|---|\n${rows || `| ${datedTxt} | ${GBP(amt ?? 0)} |`}`);
    }
    case "event_letter": {
      if (amt == null) return null;
      const payer = party ?? "Harrowgate Solicitors LLP";
      return mk("solicitor_letter", `Solicitor letter from ${payer}`,
        `We act for the estate and confirm ${cust} is entitled to a share of the proceeds.\n\n**Entitled share:** ${GBP(amt)}\n**Amount:** ${GBP(amt)}\n\nFunds were transferred by ${payer} on the date above.`);
    }
    case "register": {
      if (!party) return null;
      return mk("company_register_extract", `Company register extract for ${party}:`,
        `**Company:** ${party}\n**Status:** Active\n**Registered office:** 1 Foundry Row, Aldcote\n\n| Officer | Role | Born | Appointed | Resigned |\n|---|---|---|---|---|\n| Dana Whitlock | Director | March 1979 | 2021-05-01 | |`);
    }
    default:
      return null;
  }
}

/* ------------------------------ build case ------------------------------- */

export function buildLiveCase(s: LiveScenario): LiveCase {
  const custName = s.customerName;
  const { txns, txnIdByPaymentId } = buildTxns(s, custName);
  const fired = fireLiveAlerts(s, txns);

  const outIds = new Set(txns.filter((t) => t.direction === "out").map((t) => t.transaction_id));
  const held =
    s.institution === "payments_fx"
      ? fired.flatMap((a) => a.transaction_ids).find((id) => outIds.has(id)) ?? null
      : null;

  const alerts: Alert[] = fired.map((f, i) => ({
    alert_id: `LIVE-AL${String(i + 1).padStart(3, "0")}`,
    case_id: CASE_ID,
    customer_id: CUST_ID,
    rule_name: RULE_NAMES[f.rule_id],
    rule_id: f.rule_id,
    created_at: ALERT_AT,
    message: f.message,
    measured: f.measured,
    transaction_ids: f.transaction_ids,
  }));

  // docs (id is positional — linkedPaymentId matches a payment id, and we
  // also allow it to match the transaction id for convenience)
  const docTexts: Record<string, string> = {};
  const metas: DocMeta[] = [];
  s.docs.forEach((d, i) => {
    const made = docFor(d, s, txns, txnIdByPaymentId, i + 1);
    if (!made) return;
    metas.push(made.meta);
    docTexts[made.meta.doc_id] = made.text;
  });

  const declared =
    s.customerKind === "business"
      ? {
          source_of_funds: "Business revenue",
          account_purpose: s.activity,
          expected_countries: s.expectedCountries,
          expected_channels: ["Bank transfer from own account", "Bank transfer"],
          monthly_income_gbp: null,
          annual_turnover_gbp: Math.round(s.monthlyGbp * 12),
        }
      : {
          source_of_funds: s.employer ? "Salary" : "Salary",
          account_purpose: s.activity,
          expected_countries: s.expectedCountries,
          expected_channels: ["Card", "Bank transfer", "Direct debit", "Cash"],
          monthly_income_gbp: s.monthlyGbp,
          annual_turnover_gbp: null,
        };

  const customer = {
    kind: s.customerKind,
    name: custName,
    date_of_birth: s.customerKind === "individual" ? "1994-06-21" : null,
    occupation: s.customerKind === "individual" ? s.activity : null,
    employer: s.employer,
    company_number: s.customerKind === "business" ? "09912044" : null,
    incorporated_on: s.customerKind === "business" ? "2019-04-30" : null,
    business_activity: s.customerKind === "business" ? s.activity : null,
    address: "12 Wexham Terrace, Aldcote, AL4 8QT",
    onboarded_on: "2023-06-19",
    risk_rating: "Low",
    declared,
    customer_id: CUST_ID,
    account_ids: [ACCT_ID],
    origin: "synthetic - live sandbox",
  };

  const caseRow = {
    case_id: CASE_ID,
    institution: s.institution,
    customer_id: CUST_ID,
    opened_at: OPENED_AT,
    review_window: { ...WINDOW },
    alert_ids: alerts.map((a) => a.alert_id),
    held_payment_id: held,
    origin: "synthetic - live sandbox",
  };

  const reviews = s.priorReviewCounterparty
    ? [{
        review_id: "LIVE-R0001",
        customer_id: CUST_ID,
        reviewed_on: "2026-08-15",
        rule_id: "TM04",
        verdict: "CLOSE",
        note: `Closed. Payments involving ${s.priorReviewCounterparty} reviewed with documents on file.`,
      }]
    : [];

  const companyCp = s.listHitCounterparty && isCompany(s.listHitCounterparty);
  const list = s.listHitCounterparty
    ? [{
        entry_id: "LIVE-L0001",
        kind: companyCp ? "business" : "individual",
        name: s.listHitCounterparty,
        date_of_birth: companyCp ? null : LIST_ENTRY_DOB,
        identifiers: { internal_case: "IC-2025-900" },
        address: "1 Marsh Lane, Aldcote, AL1 1AA",
        reason: "Subject of an unresolved specialist investigation. Do not deal with this person or companies they control.",
        added_on: "2025-02-27",
      }]
    : [];

  const jl = (rows: unknown[]) =>
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");

  const files: Record<string, string> = {
    "cases.jsonl": jl([caseRow]),
    "alerts.jsonl": jl(alerts),
    "customers.jsonl": jl([customer]),
    "transactions.jsonl": jl(txns),
    "evidence.jsonl": jl(metas),
    "previous_reviews.jsonl": jl(reviews),
    "internal_list.jsonl": jl(list),
    "POLICY.md": "@@POLICY@@",
  };
  for (const [id, text] of Object.entries(docTexts)) {
    files[`evidence/${id}.md`] = text;
  }

  return {
    institution: s.institution,
    files,
    caseId: CASE_ID,
    alertIds: alerts.map((a) => a.alert_id),
    heldPaymentId: held,
    txns,
    alerts,
    context: s.contextFlags,
    docTexts,
    custName,
    custKind: s.customerKind,
    txnIdByPaymentId,
  };
}
